Below is a **detailed technical specification** for your Excel Cap-Table Copilot add-in, extended to support multi-turn slot-filling clarifications before generating the final plan.  

---

## 1. High-Level Architecture  

```
┌───────────────────────────────────────────────────────────────────┐
│ Excel Office.js Add-in (React + TypeScript)                       │
│  • ChatView & PromptPane                                         │
│  • SlotStatusBar                                                 │
│  • PreviewPane                                                   │
│  • SheetConnector                                                │
└───────────────┬──────────────────────────┬────────────────────────┘
                │                          │
        Office.js│                          │ HTTP JSON
                ▼                          ▼
┌──────────────────────────────────┐    ┌──────────────────────────┐
│ Local LLM Server (FastAPI +     │    │ llama.cpp subprocess     │
│  Dialog & Plan APIs)            │    │ (quantized Code-Llama)   │
│  • /chat                         │    └──────────────────────────┘
│  • /plan                         │
│  • In-memory Session Store       │
└──────────────────────────────────┘
```

---

## 2. Component Breakdown  

### A. Excel Add-in (Office.js / React)  

1. **ChatView**  
   - **UI**: Scrollable bubble list (user vs. assistant)  
   - **Input**: Text box + Send button  
   - **Logic**:  
     - On **Send**, POST `{ sessionId, message }` → `/chat`  
     - Append assistant reply; update SlotStatusBar  

2. **SlotStatusBar**  
   - Shows required slots and fill status:  
     ```
     ⚪ roundType   ⚪ amount   ⚪ preMoney   ⚪ poolPct
     ```
   - Turns ● green as each slot is filled  

3. **PromptPane & "Generate Plan"**  
   - Disabled until all slots filled  
   - On click, POST `{ sessionId }` → `/plan`  
   - Switches view to **PreviewPane**  

4. **PreviewPane**  
   - Renders list of ops returned by `/plan`  
   - Checkboxes + "Apply Approved" button  

5. **SheetConnector**  
   - `readSheet(): Promise<Cell[][]>` → reads active sheet  
   - `applyOps(ops: ActionOp[]): Promise<void>` → writes values/formulas  

---

### B. Local LLM Server (FastAPI / Python)  

1. **Session Store** (in-memory; migrate to Redis for production)  
   ```python
   sessions = {
     sessionId: {
       "slots": { "roundType": None, "amount": None, "preMoney": None, "poolPct": None },
       "history": [ {"role":"user","msg":...}, {"role":"assistant","msg":...} ]
     }
   }
   ```

2. **`POST /chat`**  
   - **Input**: `{ sessionId: string, message: string }`  
   - **Flow**:  
     1. Initialize session if new (generate UUID)  
     2. Append user message to history  
     3. Attempt to parse and fill any slots via simple regex/heuristics  
     4. If slots remaining:  
        - Build a few-shot prompt:
          ```
          "You are an Excel copilot… Slots: roundType, amount, preMoney, poolPct.
           History: <history>.
           Ask exactly one question to fill the next missing slot.”
          ```
        - Call LLM → assistantMessage  
        - Append to history; return `{ assistantMessage, slotsFilled: {...} }`  
     5. If all slots filled → return `{ ready: true, slots: {...} }`

3. **`POST /plan`**  
   - **Input**: `{ sessionId: string }`  
   - **Flow**:  
     1. Fetch `slots` from session  
     2. Read sheet JSON (client includes sheet data in this call)  
     3. Populate plan-generation prompt:
        ```
        "Given this cap table (as JSON rows) and parameters:
           • roundType = {roundType}
           • amount = {amount}
           • preMoney = {preMoney}
           • poolPct = {poolPct}
         Output a JSON array of operations…"
        ```
     4. Call LLM → raw JSON  
     5. Validate JSON schema (`id`, `range`, `type`, `values/formula`)  
     6. Return `{ ops: [...] }`

4. **Error Handling**  
   - If LLM output is invalid JSON: retry up to 2× with "Only return valid JSON."  
   - If missing slots on `/plan`: return `400 BadRequest`  

---

## 3. Data Models & Schemas  

### Session  
```json
{
  "sessionId": "uuid-v4",
  "slots": {
    "roundType": "Series A" | "Seed" | ...,
    "amount": 5000000,
    "preMoney": 20000000,
    "poolPct": 10
  },
  "history": [
    {"role":"user","msg":"I want a Series A pro-forma."},
    {"role":"assistant","msg":"What round amount?"}, …
  ]
}
```

### ActionOp  
```ts
type ActionOp = {
  id: string;
  range: string;            // e.g. "B2:B10"
  type: "write"|"formula";
  values?: string[][];
  formula?: string;
  note?: string;
}
```

---

## 4. Prompt Engineering  

### A. Slot-Filling Few-Shot  
```text
You are an expert Excel Cap-Table AI assistant.
Slots to collect: roundType, amount, preMoney, poolPct.
Ask exactly one question to fill the next missing slot based on conversation history.
Only ask one question at a time.
```

### B. Plan-Generation Template  
```text
You are an Excel Cap-Table AI assistant.
Cap Table (JSON): {sheetRows}
Parameters:
 • roundType = {roundType}
 • amount = {amount}
 • preMoney = {preMoney}
 • poolPct = {poolPct}
Output a JSON array of operations with fields:
  id, range (A1 notation), type ("write"|"formula"), values/formula, note.
Only return valid JSON.
```

---

## 5. Sequence of an Example Flow  

1. **User** opens add-in → **ChatView** appears.  
2. **User**: "Pro-forma a Series A cap table."  
   - Add-in `POST /chat` → server replies "Sure! What round amount?"  
3. **User**: "$5M." → `POST /chat` → replies "Great. What's the pre-money valuation?"  
4. **User**: "20 million." → `POST /chat` → "And desired pool % after close?"  
5. **User**: "10%." → `POST /chat` → `{ ready: true, slots: {...} }`  
6. UI auto-calls **`/plan`** (including sheet data) → receives `ops[]`  
7. **PreviewPane** lists ops → user approves → **applyOps()** writes to Excel.  

---

## 6. Project Structure  

```
/excel-captable-copilot
├── addin/                   # Office.js + React
│   ├── src/
│   │   ├── components/
│   │   │   ├── ChatView.tsx
│   │   │   ├── SlotStatusBar.tsx
│   │   │   ├── PreviewPane.tsx
│   │   │   └── PromptPane.tsx
│   │   ├── services/
│   │   │   ├── chatService.ts   # wrappers for /chat & /plan
│   │   │   └── sheetConnector.ts
│   │   └── App.tsx
│   └── manifest.xml
└── server/                  # FastAPI + llama.cpp wrapper
    ├── main.py              # routes: /chat, /plan
    ├── dialogs.py           # Session & Slot logic
    ├── prompts.py           # Few-shots & templates
    ├── llm.py               # llama.cpp invocation
    └── requirements.txt
```

---

## 7. Build & Test Plan  

| Phase | Tasks                                                                 | Duration |
|-------|-----------------------------------------------------------------------|----------|
| **S1**   | Scaffold Office.js React add-in with ChatView + SlotStatusBar UI      | 1 wk     |
| **S2**   | Stub FastAPI `/chat` that returns hard-coded "What round amount?"      | 1 wk     |
| **S3**   | Implement in-memory Session & slot heuristics                         | 2 wks    |
| **S4**   | Integrate LLM few-shot clarifier in `/chat`                           | 2 wks    |
| **S5**   | Extend PreviewPane; hook "Generate Plan" → `/plan`                    | 1 wk     |
| **S6**   | End-to-end QA: multi-turn flows, JSON validation, Excel integration    | 1 wk     |
| **S7**   | Beta packaging: manifest, installer script, README, sample cap-tables  | 1 wk     |

---

### Next Actions  

1. **Kick off S1** by wiring up the React components.  
2. **Parallelize S2/S3** to get a working `/chat` flow quickly.  
3. **Iterate prompts** in S4 with real user language samples.  
4. **Validate ops** in Excel with a handful of real Carta exports.  

This spec should give you a clear, actionable roadmap to build—and iteratively enhance—a conversational Cap-Table modeling copilot directly inside Excel.
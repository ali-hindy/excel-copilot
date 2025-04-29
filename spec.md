Below is a **Technical Spec & Build Outline** for your MVP: an Office.js Excel add-in that runs a local LLM to transform an entire sheet based on a plain-English prompt, shows a preview of edits, and lets users approve or reject.  

---

## 1. High-Level Architecture

```
┌──────────────────────────┐        HTTP       ┌──────────────────────────┐
│ Excel Office.js Add-in   │ ◀───────────────▶ │ Local LLM Server (FastAPI) │
│  • Task Pane UI (React)  │                  │  • llama.cpp (Code Llama)  │
│  • Prompt Input & Preview│                  │  • Prompt Templates         │
│  • Preview Diff Renderer │                  │  • JSON “Action Plan” API   │
└────────────┬─────────────┘                      └────────────┬─────────────┘
             │                                          │
             │ Office.js                                │ llama.cpp
             │ JavaScript calls                          │ inference
             ▼                                          ▼
┌──────────────────────────┐                      ┌──────────────────────────┐
│ Excel Workbook (active   │                      │ Model Files on Disk      │
│   sheet)                 │                      │  • quantized Code Llama 7B│
│  • Read sheet data       │                      │  • ggml backend           │
│  • Apply edits (ranges)  │                      └──────────────────────────┘
└──────────────────────────┘
```

---

## 2. Component Breakdown

### A. Excel Add-in (Office.js)
- **Tech Stack:**  
  - JavaScript/TypeScript, React for the task-pane UI  
  - Office.js API for workbook interactions  
- **Key Modules:**  
  1. **PromptPane**  
     - Text input for natural-language instructions  
     - “Run” button to invoke the LLM  
  2. **PreviewPane**  
     - Displays a list of proposed operations (e.g. “Set B2:B13 → …”)  
     - Checkboxes to approve/reject each op  
     - “Apply Approved” button  
  3. **SheetConnector**  
     - `readSheet(): Promise<string[][]>` — loads entire active sheet into a 2D array  
     - `applyOps(ops: ActionOp[])` — applies approved operations via Office.js  

### B. Local LLM Server
- **Tech Stack:**  
  - Python 3.9+, FastAPI for HTTP endpoints  
  - llama.cpp (via subprocess or Python wrapper) serving a quantized Code Llama 7B model for best local latency/accuracy  
- **Endpoints:**  
  1. `POST /plan`  
     - **Request:**  
       ```json
       {
         "prompt": "Use the ARR by Customer data to collapse …",
         "sheet": [["Customer","ARR",…], […], …]
       }
       ```  
     - **Response:**  
       ```json
       {
         "ops": [
           { "id": "1", "range": "A1:D1", "type": "write", "values": [["Start Month","Cohort Size","…"]]},
           { "id": "2", "range": "A2:A13", "type": "formula", "formula": "=EOMONTH(B2,0)", "note": "Populate months" },
           …
         ]
       }
       ```
- **Prompt Template (pseudo):**  
  ```
  You are an Excel assistant. Given this sheet as JSON rows and a user instruction, output a JSON list of operations. Each op must include:
    - id: unique identifier
    - range: Excel A1 notation
    - type: "write" | "formula"
    - values or formula
    - optional note
  Only return valid JSON.
  ```
- **Model Invocation:**  
  - Launch llama.cpp in server startup, keep it warmed with key-value cache.  
  - Stream answers and buffer until JSON is complete.

---

## 3. Data Flow & User Experience

1. **User opens Excel** → Ribbon button “AI Assistant” opens the Task Pane.  
2. **User types** “Collapse ARR by Customer …” → clicks **Run**.  
3. Add-in calls `readSheet()`, packages sheet + prompt → `POST http://localhost:8000/plan`.  
4. **Server** runs LLM, returns `ops[]`.  
5. Add-in renders **PreviewPane** with each op:  
   ```text
   [ ] (1) Write headers A1:D1 → ["Start Month","Cohort Size (#)","..."]
   [ ] (2) Formula A2:A13 =EOMONTH(B2,0)  “Populate months”
   …  
   ```
6. User ticks the ones they want → clicks **Apply**.  
7. Add-in’s `applyOps()` uses Office.js to set formulas/values.  
8. **Success/Error** notifications appear.

---

## 4. Detailed MVP Build Plan

| Phase | Deliverable                                             | Timeframe |
|-------|---------------------------------------------------------|-----------|
| **P1**   | **Scaffold Add-in**<br>• Yeoman Office.js React template<br>• Task pane with static prompt UI<br>• Ribbon button to open pane | 1 week    |
| **P2**   | **Sheet Read/Write**<br>• Implement `readSheet()` to return sample 2D array<br>• Implement `applyOps()` with hard-coded ops for testing | 1 week    |
| **P3**   | **Local LLM Server v0**<br>• FastAPI server stub `<POST /plan>` returning a mock JSON plan<br>• Verify HTTP comms from add-in to server | 1 week    |
| **P4**   | **Integrate llama.cpp**<br>• Bundle quantized Code Llama 7B (`.gguf`)<br>• Server runs real inference, but returns raw text | 2 weeks   |
| **P5**   | **JSON Parsing & Prompt**<br>• Build prompt template, call LLM, parse JSON ops<br>• Validate ops against sheet dims<br>• Render PreviewPane with real ops | 2 weeks   |
| **P6**   | **Preview & Apply**<br>• Checkbox UI, “Apply” button<br>• Hook `applyOps()` to dynamic ops<br>• Ensure undo/reset capability | 1 week    |
| **P7**   | **Polish & Testing**<br>• Error-handling modals for JSON or Office.js failures<br>• Basic styling and UX refinements<br>• Internal smoke tests on 3–4 sheet patterns | 1 week    |
| **P8**   | **Beta Release**<br>• Package add-in (manifest + assets)<br>• Docker image or script for installing LLM server dependencies<br>• “Getting Started” guide for beta analysts | 1 week    |

_Total MVP timeline: ~10–11 weeks._

---

## 5. Engineering & Deployment Details

1. **Repo Structure**  
   ```
   /mvp-cursor-excel
   ├── addin/                # Office.js React project
   │   ├── src/
   │   │   ├── PromptPane.tsx
   │   │   ├── PreviewPane.tsx
   │   │   └── SheetConnector.ts
   │   └── manifest.xml
   └── server/               # FastAPI + llama.cpp wrapper
       ├── main.py           # FastAPI app
       ├── model.py          # llama.cpp launch & prompt handling
       └── requirements.txt
   ```
2. **Local LLM Setup**  
   - **Dependencies:** `llama.cpp` compiled with `GGML_USE_CUBLAS=1` if GPU available, else CPU fallback.  
   - **Model File:** `code-llama-7b.gguf` placed in `server/models/`.  
   - **Server Launch Script:**  
     ```bash
     cd server
     pip install -r requirements.txt
     # ensure llama.cpp binary is in PATH
     uvicorn main:app --port 8000 --host 127.0.0.1
     ```
3. **Office.js Communication**  
   - Use `fetch("http://127.0.0.1:8000/plan", { method: "POST", body: JSON.stringify({prompt, sheet}) })`  
   - Handle CORS by enabling `app.add_middleware(CORSMiddleware, allow_origins=["*"])` in FastAPI (for MVP).  
4. **Prompt Engineering**  
   - Start with tight examples: feed small sheets (≤100 rows).  
   - Iterate on the template so JSON ops conform to spec; include examples of “header write” and “formula” ops.  
5. **Testing**  
   - Manual: prepare 3 different sample sheets (e.g. cohort analysis, pivot-style data, text cleanup) to validate.  
   - Unit: mock `/plan` responses to test PreviewPane and apply logic.

---

### Next Steps

1. **Kick off P1 immediately** by generating the Office.js React add-in scaffold.  
2. **Stand up the FastAPI stub** in parallel for P3 so you can wire up communications quickly.  
3. **Secure hardware** for local LLM testing (a GPU machine if possible, otherwise CPU).  
4. **Recruit 3–5 beta analysts** to give feedback on initial P2/P3 prototypes.


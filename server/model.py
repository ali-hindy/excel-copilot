import json
import re # For finding JSON block
from pathlib import Path
from llama_cpp import Llama
from typing import List, Dict, Any # Added Dict, Any

# --- Configuration ---
MODEL_DIR = Path(__file__).parent / "models"
# Make sure you download the model and place it here
MODEL_PATH = MODEL_DIR / "codellama-7b-instruct.Q4_K_M.gguf"
N_GPU_LAYERS = 1  # Metal support - adjust if using CUDA or CPU
N_CTX = 2048      # Context window size

# --- Prompt Template (Initial Version for P4/P5) ---
# This will be refined in Phase 5
PROMPT_TEMPLATE = """
[INST] You are an Excel assistant. The user has provided the following sheet data (as a JSON list of lists):
```json
{sheet_data}
```

User instruction: "{user_prompt}"

Based on the sheet and the instruction, generate a JSON list of operations to perform. Each operation must be an object with the following keys:
- "id": A unique string identifier for the operation (e.g., "op-1", "op-2").
- "range": The Excel range in A1 notation (e.g., "A1", "B2:C5").
- "type": Either "write" or "formula".
- "values": A list of lists containing the values to write (only for type "write", use null otherwise).
- "formula": The formula string starting with '=' (only for type "formula", use null otherwise).
- "note": An optional short string explaining the operation.

Return *only* the JSON list of operations, enclosed in a single markdown ```json ... ``` block. Ensure the JSON is valid. [/INST]
```json
"""

# --- LLM Loading --- 
llm = None
def get_llm():
    global llm
    if llm is None:
        if not MODEL_PATH.exists():
            raise FileNotFoundError(f"Model file not found at {MODEL_PATH}. Please download the model.")
        print(f"Loading model from {MODEL_PATH}...")
        llm = Llama(
            model_path=str(MODEL_PATH),
            n_ctx=N_CTX,
            n_gpu_layers=N_GPU_LAYERS, # Comment out or set to 0 if no GPU acceleration
            verbose=True, # Set to False for less output
        )
        print("Model loaded successfully.")
    return llm

# --- Inference Function (P4 - Raw Text Output) ---
async def generate_plan_raw_text(prompt: str, sheet_data: List[List[str]]) -> str:
    client = get_llm()
    
    # Simple JSON conversion for the sheet data
    MAX_SHEET_CHARS = 1500 # Increased slightly
    sheet_json = json.dumps(sheet_data)
    if len(sheet_json) > MAX_SHEET_CHARS:
        print(f"Warning: Sheet data truncated from {len(sheet_json)} to {MAX_SHEET_CHARS} characters.")
        sheet_json = sheet_json[:MAX_SHEET_CHARS] + '...'

    full_prompt = PROMPT_TEMPLATE.format(sheet_data=sheet_json, user_prompt=prompt)

    print("\n--- Sending Prompt to LLM ---")
    # print(full_prompt) # Keep prompt logging minimal for clarity
    print("Prompt sent (see model.py for template)")
    print("-----------------------------\n")

    response = client.create_completion(
        prompt=full_prompt,
        max_tokens=1024,  # Increase max tokens for potentially complex plans
        temperature=0.2, # Lower temperature further for structured output
        stop=["```", "[/INST]"], # Stop generation at closing JSON block or potential instruction end
        echo=False,      
    )

    raw_output = response['choices'][0]['text'].strip()
    # Add the closing ``` if llama.cpp stopped before emitting it
    if not raw_output.endswith("```"):
        raw_output += "\n```"

    print(f"\n--- LLM Raw Output ---\n{raw_output}\n----------------------\n")
    return raw_output

# --- Phase 5: JSON Parsing --- 
def parse_llm_output_to_ops(raw_text: str) -> List[Dict[str, Any]]:
    """Extracts and parses the JSON block from the LLM's raw output."""
    
    # Use regex to find the JSON block, allowing for potential leading/trailing whitespace
    match = re.search(r"```json\s*(\[.*?\])\s*```", raw_text, re.DOTALL)
    
    if not match:
        # Fallback: Sometimes the model might just return the list without ```json
        # Need to be careful here not to grab random brackets
        raw_text_stripped = raw_text.strip()
        if raw_text_stripped.startswith("[") and raw_text_stripped.endswith("]"):
             print("Warning: Assuming entire stripped output is the JSON list.")
             json_str = raw_text_stripped
        else:
            print("ERROR: Could not find JSON block or list in LLM output.")
            raise ValueError("LLM did not return a valid JSON block or list.")
    else:
        json_str = match.group(1).strip()
    
    try:
        parsed_ops = json.loads(json_str)
        if not isinstance(parsed_ops, list):
            raise TypeError("Parsed JSON is not a list.")
        
        # Basic validation of required keys (can be expanded)
        validated_ops = []
        for i, op in enumerate(parsed_ops):
            if not isinstance(op, dict):
                 print(f"Warning: Operation {i} is not a dictionary, skipping.")
                 continue
            if not all(key in op for key in ["id", "range", "type"]):
                print(f"Warning: Operation {i} is missing required keys (id, range, type), skipping: {op}")
                continue
            # Ensure required value/formula based on type
            op_type = op.get("type")
            if op_type == "write" and op.get("values") is None:
                 print(f"Warning: Operation {i} is type 'write' but missing 'values', skipping: {op}")
                 continue
            if op_type == "formula" and op.get("formula") is None:
                 print(f"Warning: Operation {i} is type 'formula' but missing 'formula', skipping: {op}")
                 continue
                 
            validated_ops.append(op)

        print(f"Successfully parsed {len(validated_ops)} operations.")
        return validated_ops

    except json.JSONDecodeError as e:
        print(f"ERROR: Failed to decode JSON from LLM output: {e}")
        print("--- Faulty JSON String ---:")
        print(json_str)
        print("-------------------------")
        raise ValueError(f"LLM output contained invalid JSON: {e}")
    except TypeError as e:
        print(f"ERROR: Parsed JSON logic error or result not a list: {e}")
        raise ValueError(f"LLM did not return a valid JSON list: {e}")

# TODO P5: Add function to parse raw_output into ActionOp list
# async def parse_llm_output(raw_text: str) -> List[dict]: ... 
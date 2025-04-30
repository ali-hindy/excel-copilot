import json
import re  # For finding JSON block
from pathlib import Path
from llama_cpp import Llama
from typing import List, Dict, Any  # Added Dict, Any

# --- Configuration ---
MODEL_DIR = Path(__file__).parent / "models"
# Make sure you download the model and place it here
MODEL_PATH = MODEL_DIR / "codellama-7b-instruct.Q4_K_M.gguf"
N_GPU_LAYERS = 1  # Metal support - adjust if using CUDA or CPU
N_CTX = 2048  # Context window size

# --- Prompt Template (Initial Version for P4/P5) ---
# This will be refined in Phase 5
PROMPT_TEMPLATE = """
[INST] You are an Excel assistant. Generate a plan to model a cap table based on the provided parameters and sheet data.

Parameters:
```json
{slots}
```

Sheet Data:
```json
{sheet_data}
```

Task: Generate a JSON list of operations to model the funding round described by the parameters, using the provided sheet data as context or a starting point. Each operation must be an object with the following keys:
- "id": A unique string identifier for the operation (e.g., "op-1", "op-2").
- "range": The Excel range in A1 notation (e.g., "A1", "B2:C5").
- "type": Either "write", "formula", or "color".
- "values": A list of lists containing the values to write (only for type "write", use null otherwise).
- "formula": The formula string starting with '=' (only for type "formula", use null otherwise).
- "color": The color name (e.g., "blue", "green") or hex code (e.g., "#4F81BD") to apply (only for type "color", use null otherwise).
- "note": An optional short string explaining the operation.

IMPORTANT RULES:
1. Analyze the Parameters ({slots}) to understand the round details (roundType, amount, preMoney, poolPct).
2. Use the Sheet Data ({sheet_data}) as the existing context. Your operations should modify or add to this data.
3. Generate operations to set up headers, input parameters, calculate post-money valuation, share prices, and the final cap table structure based on the parameters.
4. Be efficient - use ranges instead of individual cells when possible.
5. Limit operations to what's necessary to achieve the goal.
6. Maximum of 20 operations per plan.
7. Ensure all operations are valid and necessary.
8. Ensure proper JSON formatting:
   - Use double quotes for all keys and string values.
   - Use null for optional fields that are not applicable.
   - No trailing commas.

Return *only* the JSON list of operations, enclosed in a single markdown ```json ... ``` block. Ensure the JSON is valid. [/INST]
```json
"""

# --- Constants for Operation Limits ---
MAX_OPERATIONS = 20
MAX_TOKENS = 2048
TEMPERATURE = 0.2

# --- LLM Loading ---
llm = None


def get_llm():
    global llm
    if llm is None:
        if not MODEL_PATH.exists():
            raise FileNotFoundError(
                f"Model file not found at {MODEL_PATH}. Please download the model."
            )
        print(f"Loading model from {MODEL_PATH}...")
        llm = Llama(
            model_path=str(MODEL_PATH),
            n_ctx=N_CTX,
            n_gpu_layers=N_GPU_LAYERS,  # Comment out or set to 0 if no GPU acceleration
            verbose=True,  # Set to False for less output
        )
        print("Model loaded successfully.")
    return llm


# --- Inference Function (P4 - Raw Text Output) ---
async def generate_plan_raw_text(slots: Dict[str, Any], sheet_data: List[List[str]]) -> str:
    client = get_llm()

    # Simple JSON conversion for the sheet data
    MAX_SHEET_CHARS = 1500  # Increased slightly
    sheet_json = json.dumps(sheet_data)
    if len(sheet_json) > MAX_SHEET_CHARS:
        print(
            f"Warning: Sheet data truncated from {len(sheet_json)} to {MAX_SHEET_CHARS} characters."
        )
        sheet_json = sheet_json[:MAX_SHEET_CHARS] + "..."

    slots_json = json.dumps(slots)

    full_prompt = PROMPT_TEMPLATE.format(sheet_data=sheet_json, slots=slots_json)

    print("\n--- Sending Prompt to LLM ---")
    print("Prompt template: (see model.py)")
    print("-----------------------------\n")

    response = client.create_completion(
        prompt=full_prompt,
        max_tokens=MAX_TOKENS,
        temperature=TEMPERATURE,
        stop=[
            "```",
            "[/INST]",
            "```json",  # Add this to prevent multiple JSON blocks
        ],
        echo=False,
    )

    raw_output = response["choices"][0]["text"].strip()
    # Add the closing ``` if llama.cpp stopped before emitting it
    if not raw_output.endswith("```"):
        raw_output += "\n```"

    print(f"\n--- LLM Raw Output ---\n{raw_output}\n----------------------\n")
    return raw_output


# --- Phase 5: JSON Parsing ---
def parse_llm_output_to_ops(raw_text: str) -> List[Dict[str, Any]]:
    """
    Extracts and parses the JSON block from the LLM's raw output.
    Handles output wrapped in ```json ... ```, ``` ... ```, or just the JSON list.
    Attempts to fix common JSON formatting issues and handle truncation.
    """
    def fix_json_string(json_str: str) -> str:
        # Fix common JSON formatting issues
        json_str = json_str.strip()
        # Remove any trailing commas before closing brackets/braces
        json_str = re.sub(r',(\s*[}\]])', r'\1', json_str)
        # Ensure proper string quotes
        json_str = re.sub(r"'(.*?)'", r'"\1"', json_str)
        # Fix missing commas between array elements
        json_str = re.sub(r'}\s*{', '},{', json_str)
        return json_str

    # Try ```json ... ```
    match = re.search(r"```json\s*(\[.*?\])\s*```", raw_text, re.DOTALL)
    if not match:
        # Try generic triple-backtick: ``` ... ```
        match = re.search(r"```\s*(\[.*?\])\s*```", raw_text, re.DOTALL)
    if match:
        json_str = match.group(1).strip()
    else:
        raw_text_stripped = raw_text.strip().strip("`").strip()
        start = raw_text_stripped.find("[")
        end = raw_text_stripped.rfind("]")
        if start != -1:
            # Try to find the *actual* end of the list, possibly truncated
            # Find the last occurrence of a closing brace '}' within the potential list
            potential_list_content = raw_text_stripped[start:]
            last_brace = potential_list_content.rfind('}')
            if last_brace != -1:
                # Assume the list ends after this last object
                json_str = potential_list_content[:last_brace + 1] + "]" # Add the closing bracket
            elif end != -1 and end > start: # Fallback to original end bracket logic if no braces found
                json_str = raw_text_stripped[start : end + 1]
            else:
                json_str = "[]" # Default to empty list if no start bracket found
                print("Warning: Could not find start bracket '[' in LLM output.")
        else:
            print("ERROR: Could not find JSON block or list in LLM output.")
            raise ValueError("LLM did not return a valid JSON block or list.")

    # Fix common JSON formatting issues AFTER extraction
    json_str = fix_json_string(json_str)

    try:
        # Attempt to load the potentially fixed/truncated JSON
        parsed_ops = json.loads(json_str)
        if not isinstance(parsed_ops, list):
            # Handle cases where the extracted string isn't actually a list
            # (e.g., if LLM returned a single object without brackets)
            if isinstance(parsed_ops, dict):
                print("Warning: LLM returned a single JSON object, wrapping in a list.")
                parsed_ops = [parsed_ops] # Wrap it in a list
            else:
                raise TypeError("Parsed JSON is not a list or a dictionary.")
        
        # Enforce operation limit
        if len(parsed_ops) > MAX_OPERATIONS:
            print(f"Warning: Truncating operations from {len(parsed_ops)} to {MAX_OPERATIONS}")
            parsed_ops = parsed_ops[:MAX_OPERATIONS]
            
        # Basic validation: Only check for existence of core keys
        # Let Pydantic handle detailed validation later
        validated_ops = []
        for i, op in enumerate(parsed_ops):
            if not isinstance(op, dict):
                print(f"Warning: Operation {i} is not a dictionary, skipping.")
                continue
            # ONLY check for absolutely required keys here
            if not all(key in op for key in ["id", "range", "type"]):
                print(
                    f"Warning: Operation {i} is missing core keys (id, range, type), skipping: {op}"
                )
                continue
            # Removed checks for value/formula presence based on type here
            validated_ops.append(op)
        
        print(f"Successfully parsed {len(validated_ops)} potential operations.")
        return validated_ops
    except json.JSONDecodeError as e:
        print(f"ERROR: Failed to decode JSON from LLM output: {e}")
        print("--- Faulty JSON String Attempted ---:")
        print(json_str)
        print("-----------------------------------")
        raise ValueError(f"LLM output contained invalid JSON after fixing attempts: {e}")
    except TypeError as e:
        print(f"ERROR: Parsed JSON logic error: {e}")
        raise ValueError(f"LLM did not return a valid JSON list/object: {e}")


# TODO P5: Add function to parse raw_output into ActionOp list
# async def parse_llm_output(raw_text: str) -> List[dict]: ...

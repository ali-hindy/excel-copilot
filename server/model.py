import json
import re  # For finding JSON block
from pathlib import Path
from llama_cpp import Llama
from typing import List, Dict, Any  # Added Dict, Any
import logging # Import logging

# Get a logger for this module
logger = logging.getLogger(__name__) 

# --- Configuration ---
MODEL_DIR = Path(__file__).parent / "models"
# Make sure you download the model and place it here
MODEL_PATH = MODEL_DIR / "codellama-7b-instruct.Q4_K_M.gguf"
N_GPU_LAYERS = -1  # Offload as many layers as possible to Metal GPU
N_CTX = 2048  # Context window size

# --- Prompt Template (Initial Version for P4/P5) ---
# This will be refined in Phase 5
PROMPT_TEMPLATE = """
[INST] You are an Excel assistant analyzing sheet data.

Input Range Address: {selectedRangeAddress}

Sheet Data:
```json
{sheet_data}
```

Task: Analyze the Sheet Data headers (if any) and content to identify the columns containing essential pre-round cap table information. Determine the 0-based column index for:
- "shareholder_name_col_idx"
- "pre_round_shares_col_idx"
- "pre_round_investment_col_idx" (use null if not clearly identifiable)

Provide the output as a single, valid JSON object containing ONLY the "column_mapping" key with the identified indices.

IMPORTANT RULES:
1. Carefully analyze the Sheet Data headers and structure to determine the correct column indices.
2. If a column isn't present or clearly identifiable, use null for its index.
3. Return ONLY the valid JSON object below. Do not include explanations, notes, or markdown formatting like ```json.

Example Output Format:
{{
  "column_mapping": {{
    "shareholder_name_col_idx": 0,
    "pre_round_shares_col_idx": 2,
    "pre_round_investment_col_idx": 1
  }}
}}
[/INST]
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
def generate_plan_raw_text(slots: Dict[str, Any], sheet_data: List[List[str]], selectedRangeAddress: str) -> str:
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

    # Pass address to the prompt format
    full_prompt = PROMPT_TEMPLATE.format(
        sheet_data=sheet_json, 
        slots=slots_json, 
        selectedRangeAddress=selectedRangeAddress # Address is for context, not direct use by LLM now
    )

    # DEBUG: Log the full prompt using INFO level for visibility
    # print(f"Full prompt being sent to LLM:\n{full_prompt}")

    print("\n--- Sending Calculation Prompt to LLM ---") # Updated log message

    response = client.create_completion(
        prompt=full_prompt,
        max_tokens=MAX_TOKENS,
        temperature=TEMPERATURE,
        stop=[
            "```",
            "[/INST]",
        ],
        echo=False,
    )

    raw_output = response["choices"][0]["text"].strip()
    
    # Keep the existing logic that tries to ensure it ends with '}' just in case
    if not raw_output.endswith("}"):
        # Find the last brace and trim, or add if completely missing
        last_brace_pos = raw_output.rfind('}')
        if last_brace_pos != -1:
             # If the structure is like { "key": { ... } <- stopped here
             # We need to add the final brace.
             # Let's check if the content *looks* like it needs closing.
             # A simple check: count open vs close braces
             if raw_output.count('{') > raw_output.count('}'):
                 raw_output += "}"
             else:
                 # It has balanced braces, but maybe ends early? Trim to last brace.
                 # This might still be imperfect.
                 raw_output = raw_output[:last_brace_pos+1]

        elif raw_output.startswith("{"):
             # Starts with { but has no } at all, add one.
             raw_output += "}"
        else:
            # Doesn't look like JSON object, default to empty
            raw_output = "{}"


    print(f"\n--- LLM Raw Calculation Output ---\n{raw_output}\n----------------------\n") # Updated log message
    return raw_output


# --- Phase 5: JSON Parsing (Update to parse only column mapping) ---
# Rename function
def parse_column_mapping(raw_text: str) -> Dict[str, Any]:
    """
    Parses the JSON object containing column mapping from the LLM.
    Attempts to fix common JSON formatting issues and find the JSON block.
    """
    def fix_json_string(json_str: str) -> str:
        # Basic JSON string cleaning
        json_str = json_str.strip()
        # Ensure proper string quotes (basic)
        json_str = re.sub(r"'(.*?)'", r'""', json_str)
        # Remove any trailing commas before closing brackets/braces
        json_str = re.sub(r',(\s*[}\]])', r'\1', json_str)
        return json_str

    # --- Find the JSON block --- 
    start_index = raw_text.find('{')
    end_index = raw_text.rfind('}')

    if start_index == -1 or end_index == -1 or end_index < start_index:
        logger.error(f"Could not find JSON block starting with {{ and ending with }} in LLM output: {raw_text}")
        raise ValueError("Could not find JSON object block in LLM output.")
        
    # Extract the potential JSON string
    json_str = raw_text[start_index : end_index + 1]
    logger.info(f"Extracted potential JSON block: {json_str}")
    # -------------------------

    # Fix common JSON formatting issues AFTER extraction
    json_str = fix_json_string(json_str)

    try:
        # Attempt to load the potentially fixed JSON object
        parsed_data = json.loads(json_str)
        if not isinstance(parsed_data, dict):
            raise TypeError("Parsed JSON is not a dictionary.")

        # Validate structure
        if "column_mapping" not in parsed_data or not isinstance(parsed_data["column_mapping"], dict):
            logger.error(f"LLM did not return expected 'column_mapping' dictionary: {parsed_data}")
            raise ValueError("LLM output missing or invalid 'column_mapping' key/structure.")
            
        mapping = parsed_data["column_mapping"]
        map_keys = ["shareholder_name_col_idx", "pre_round_shares_col_idx", "pre_round_investment_col_idx"]
        # Check if *all* expected keys are present (optional, depending on strictness)
        # if not all(key in mapping for key in map_keys):
        #      logger.warning(f"LLM output missing some expected column_mapping keys: {mapping}")
             # Allow partial results for now

        print(f"Successfully parsed LLM column mapping: {mapping}")
        return mapping # Return only the inner mapping dict
        
    except json.JSONDecodeError as e:
        print(f"ERROR: Failed to decode JSON column mapping from extracted block: {e}")
        print("--- Faulty JSON String Attempted ---:")
        print(json_str)
        print("-----------------------------------")
        raise ValueError(f"LLM output block contained invalid JSON after fixing attempts: {e}")
    except TypeError as e:
        print(f"ERROR: Parsed JSON logic error: {e}")
        raise ValueError(f"LLM did not return a valid JSON dictionary for column mapping: {e}")


# TODO P5: Add function to parse raw_output into ActionOp list
# async def parse_llm_output(raw_text: str) -> List[dict]: ...

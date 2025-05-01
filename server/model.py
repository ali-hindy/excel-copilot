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

# --- Custom Operations Template ---
CUSTOM_PROMPT_TEMPLATE = """
[INST] You are an Excel assistant. The user has provided the following sheet data (as a JSON list of lists):
```json
{sheet_data}
```

User instruction: "{user_prompt}"

Based on the sheet and the instruction, generate a JSON list of operations to perform. Each operation must be an object with the following keys:
- "id": A unique string identifier for the operation (e.g., "op-1", "op-2").
- "range": The Excel range in A1 notation (e.g., "A1", "B2:C5").
- "type": Either "write", "formula", or "color".
- "values": A list of lists containing the values to write (only for type "write", use null otherwise).
- "formula": The formula string starting with '=' (only for type "formula", use null otherwise).
- "color": The color to apply (only for type "color", use null otherwise). Colors can be:
  - "red", "green", "blue", "yellow", "orange", "purple", "gray", "black", "white"
  - Or a hex color code like "#FF0000" for red
- "note": An optional short string explaining the operation.

IMPORTANT RULES:
1. Be efficient - use ranges instead of individual cells when possible
2. Limit operations to what's necessary to achieve the goal
3. For writing multiple values, use a single operation with a range
4. Maximum of 20 operations per plan
5. Do not generate operations for cells outside the provided sheet data
6. Ensure all operations are valid and necessary
7. For color operations, specify the exact color requested or use standard color names
8. Ensure proper JSON formatting:
   - Use double quotes for strings
   - Separate array elements with commas
   - Close all brackets and braces
   - No trailing commas
9. If the user mentions any of these values, extract them:
   - roundType: "Series A", "Seed", etc.
   - amount: numeric value (e.g., 5000000 for $5M)
   - preMoney: numeric value (e.g., 20000000 for $20M)
   - poolPct: numeric value (e.g., 10 for 10%)

Return *only* the JSON list of operations, enclosed in a single markdown ```json ... ``` block. Ensure the JSON is valid. [/INST]
```json
"""

# --- Constants for Operation Limits ---
MAX_OPERATIONS = 20
MAX_TOKENS = 2048
TEMPERATURE = 0.2

# --- Constants for Custom Operations ---
CUSTOM_MAX_TOKENS = 2048
CUSTOM_TEMPERATURE = 0.2
CUSTOM_MAX_OPERATIONS = 20

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
        json_str = re.sub(r"'(.*?)'", r'""', json_str)
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


# --- Custom Operations Functions ---
def generate_custom_plan_raw_text(prompt: str, sheet_data: List[List[str]]) -> str:
    """
    Generate a raw text plan from custom user instructions.
    Uses a different prompt template focused on user-defined operations.
    """
    client = get_llm()

    # Simple JSON conversion for the sheet data
    MAX_SHEET_CHARS = 1500
    sheet_json = json.dumps(sheet_data)
    if len(sheet_json) > MAX_SHEET_CHARS:
        logger.warning(
            f"Sheet data truncated from {len(sheet_json)} to {MAX_SHEET_CHARS} characters."
        )
        sheet_json = sheet_json[:MAX_SHEET_CHARS] + "..."

    full_prompt = CUSTOM_PROMPT_TEMPLATE.format(sheet_data=sheet_json, user_prompt=prompt)

    logger.info("\n--- Sending Custom Prompt to LLM ---")
    logger.info("Prompt sent (custom template for operations)")

    response = client.create_completion(
        prompt=full_prompt,
        max_tokens=CUSTOM_MAX_TOKENS,
        temperature=CUSTOM_TEMPERATURE,
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

    logger.info(f"\n--- LLM Raw Output for Custom Plan ---\n{raw_output[:100]}...(truncated)\n")
    return raw_output


def parse_custom_llm_output_to_ops(raw_text: str) -> List[Dict[str, Any]]:
    """
    Extracts and parses the JSON block from the LLM's raw output for custom operations.
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
                logger.warning("Could not find start bracket '[' in LLM output.")
        else:
            logger.error("ERROR: Could not find JSON block or list in LLM output.")
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
                logger.warning("LLM returned a single JSON object, wrapping in a list.")
                parsed_ops = [parsed_ops] # Wrap it in a list
            else:
                raise TypeError("Parsed JSON is not a list or a dictionary.")

        # Enforce operation limit
        if len(parsed_ops) > CUSTOM_MAX_OPERATIONS:
            logger.warning(f"Truncating operations from {len(parsed_ops)} to {CUSTOM_MAX_OPERATIONS}")
            parsed_ops = parsed_ops[:CUSTOM_MAX_OPERATIONS]

        # Basic validation: Only check for existence of core keys
        validated_ops = []
        for i, op in enumerate(parsed_ops):
            if not isinstance(op, dict):
                logger.warning(f"Operation {i} is not a dictionary, skipping.")
                continue
            # ONLY check for absolutely required keys here
            if not all(key in op for key in ["id", "range", "type"]):
                logger.warning(
                    f"Operation {i} is missing core keys (id, range, type), skipping: {op}"
                )
                continue
            validated_ops.append(op)

        logger.info(f"Successfully parsed {len(validated_ops)} potential operations.")
        return validated_ops
    except json.JSONDecodeError as e:
        logger.error(f"ERROR: Failed to decode JSON from LLM output: {e}")
        logger.error("--- Faulty JSON String Attempted ---:")
        logger.error(json_str)
        raise ValueError(f"LLM output contained invalid JSON after fixing attempts: {e}")
    except TypeError as e:
        logger.error(f"ERROR: Parsed JSON logic error: {e}")
        raise ValueError(f"LLM did not return a valid JSON list/object: {e}")


# TODO P5: Add function to parse raw_output into ActionOp list
# async def parse_llm_output(raw_text: str) -> List[dict]: ...

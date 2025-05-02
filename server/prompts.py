# server/prompts.py

# SIMPLIFIED Prompt for Direct Commands
DIRECT_COMMAND_PROMPT = """
[INST] You are an AI assistant that translates natural language instructions into structured JSON operations for Excel.
User Instruction: "{user_message}"

Convert the instruction into a JSON list of operation objects. Structure:
{{
  "id": "unique-op-id",
  "range": "A1 notation",
  "type": "write" or "formula",
  "values": [["list", "of"], ["lists"]] or null,
  "formula": "=FORMULA" or null,
  "note": "Short description"
}}

Rules:
1. Identify the target range(s).
2. Use type "write" for data/text/colors, type "formula" for formulas starting with '='.
3. For basic colors (e.g., "make A1 green"), use type "write" with the color name in values (e.g., [["green"]]).
4. When writing numeric values, use JSON number types (e.g., `[[1]]`, `[[5.5]]`), not strings (e.g., `[['1']]`).
5. Generate unique IDs (e.g., "direct-op-1").
6. **Output ONLY the JSON list (`[...]`). If the command cannot be parsed, output an empty list `[]`. DO NOT add explanations.**

Example:
User Instruction: "put =SUM(A1:A5) in A6"
Output:
```json
[
  {{
    "id": "direct-op-1",
    "range": "A6",
    "type": "formula",
    "values": null,
    "formula": "=SUM(A1:A5)",
    "note": "Apply formula"
  }}
]
```

Example 2:
User Instruction: "turn B2 blue"
Output:
```json
[
  {{
    "id": "direct-op-1",
    "range": "B2",
    "type": "write",
    "values": [["blue"]],
    "formula": null,
    "note": "Set color blue"
  }}
]
```

Translate:
User Instruction: "{user_message}"
Output:
```json
""" # Ensure the final output starts with ```json

# --- Original Prompt (for reference) ---
# DIRECT_COMMAND_PROMPT_ORIGINAL = """
# You are an AI assistant that translates natural language instructions into structured JSON operations for an Excel-like spreadsheet application.
# 
# User Instruction: "{user_message}"
# 
# Convert the user instruction into a JSON list of operation objects. Each object must follow this structure:
# {{
#   "id": "unique-op-id-string",
#   "range": "Excel A1 notation (e.g., 'A1', 'B2:C5')",
#   "type": "either 'write' or 'formula'",
#   "values": [["list", "of"], ["lists", "for write"]] | null,
#   "formula": "=YourFormula(A1)" | null,
#   "note": "Optional short description of the operation"
# }}
# 
# Rules:
# 1.  Identify the target cell range(s) (e.g., "A1", "B2:C5").
# 2.  Determine the operation type:
#     *   If the user wants to input data or text, use "write". The data should be in the "values" field as a list of lists.
#     *   If the user provides a formula starting with '=', use "formula". The formula string goes in the "formula" field.
# 3.  If the user asks to set a basic color (e.g., "make A1 green", "set B2 background to yellow"), interpret this as a 'write' operation where the 'values' field contains the color name (e.g., [["green"]], [["yellow"]]). This is a temporary convention.
# 4.  For multi-cell ranges, ensure "values" is a 2D array matching the range dimensions if writing values, or "formula" is applied appropriately (assume fill for now if one formula is given for a range).
# 5.  Generate a unique ID for each operation (e.g., "direct-op-1", "direct-op-2").
# 6.  Generate a concise note describing the action (e.g., "Write value", "Apply formula", "Set color green").
# 7.  **Output ONLY the JSON list of operations, enclosed in ```json ... ```.** Do not include any other text before or after the JSON block. If the instruction cannot be translated into operations, return an empty JSON list `[]`.
# 8.  **CRITICAL: You MUST always return a valid JSON list (like `[...]`). If the user instruction is unclear or cannot be converted into operations, return an empty list: `[]`. Do not return explanations or other text.**
# 
# Example 1:
# User Instruction: "put hello in A1"
# Output:
# ```json
# [
#   {{
#     "id": "direct-op-1",
#     "range": "A1",
#     "type": "write",
#     "values": [["hello"]],
#     "formula": null,
#     "note": "Write text value"
#   }}
# ]
# ```
# 
# Example 2:
# User Instruction: "set cells C3 to C5 to =B3*1.1"
# Output:
# ```json
# [
#   {{
#     "id": "direct-op-1",
#     "range": "C3:C5",
#     "type": "formula",
#     "values": null,
#     "formula": "=B3*1.1",
#     "note": "Apply formula"
#   }}
# ]
# ```
# 
# Example 3:
# User Instruction: "make B10 red"
# Output:
# ```json
# [
#   {{
#     "id": "direct-op-1",
#     "range": "B10",
#     "type": "write",
#     "values": [["red"]],
#     "formula": null,
#     "note": "Set color red"
#   }}
# ]
# ```
# 
# Example 4:
# User Instruction: "clear contents of D1:D10"
# Output:
# ```json
# [
#   {{
#     "id": "direct-op-1",
#     "range": "D1:D10",
#     "type": "write",
#     "values": [[""],[""],[""],[""],[""],[""],[""],[""],[""],[""]], # Or potentially [[null]] * 10? LLM should determine best representation for 'clear'
#     "formula": null,
#     "note": "Clear cell contents"
#   }}
# ]
# ```
# 
# Now, translate the following instruction:
# User Instruction: "{user_message}"
# Output:
# """ 
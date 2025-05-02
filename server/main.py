from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ValidationError
from typing import List, Any, Optional, Dict
from pathlib import Path
import logging
import json
import uuid
from fastapi.responses import JSONResponse
import re

# Import LLM functions using absolute imports from project root
from model import (
    generate_plan_raw_text,
    get_llm,
    parse_column_mapping,
    generate_custom_plan_raw_text,
    parse_custom_llm_output_to_ops,
    parse_direct_command_to_ops
)
from dialogs import get_or_create_session, process_message

# Add import for custom operations functions
# from model import generate_custom_plan_raw_text, parse_custom_llm_output_to_ops # Removed duplicate

app = FastAPI()

logger = logging.getLogger("uvicorn")

# --- Simple In-Memory Storage for Task Results (Replace with DB/Redis for production) ---
task_results: Dict[str, Dict] = {}


# --- Load LLM on startup (optional, but recommended) ---
@app.on_event("startup")
async def startup_event():
    try:
        get_llm()  # Initialize and load the LLM
    except FileNotFoundError as e:
        print(f"STARTUP ERROR: {e}")
        # You might want to prevent server startup or handle this differently
    except Exception as e:
        print(f"STARTUP ERROR: Could not load LLM - {e}")


# --- CORS Middleware (Allow all for MVP) ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for development
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"],
)


# Add root endpoint for health check
@app.get("/")
async def root():
    return {"status": "ok", "message": "Server is running"}


# Add specific OPTIONS handler for /plan endpoint
@app.options("/plan")
async def plan_options():
    return {"status": "ok"}


# --- Request/Response Models ---
class ChatRequest(BaseModel):
    sessionId: Optional[str] = None
    message: str


# --- Keep original ChatResponse for process_message return type hinting if needed, or remove if unused ---
# class ChatResponse(BaseModel):
#     sessionId: str
#     assistantMessage: str
#     slotsFilled: dict
#     ready: bool


class PlanRequest(BaseModel):
    # prompt: str # Remove requirement for prompt
    # sheet: List[List[str]] # Sheet data will be included
    slots: Dict[str, Any]  # Expect the collected slots
    sheetData: List[List[str]]  # Expect the sheet data from selected range
    selectedRangeAddress: str  # Expect the address of the input range


class ActionOp(BaseModel):
    id: str
    range: str
    type: str  # "write" | "formula"
    values: List[List[Any]] | None = None  # Allow Any in values
    formula: str | None = None
    note: str | None = None


# --- NEW Unified Response Model for /chat ---
class UnifiedChatResponse(BaseModel):
    sessionId: str
    # Fields for slot-filling/modeling flow
    assistantMessage: Optional[str] = None
    slotsFilled: Optional[dict] = None
    ready: Optional[bool] = None
    # Field for direct actions
    directOps: Optional[List[ActionOp]] = None
    # General status/error message?
    message: Optional[str] = None
    error: Optional[str] = None


class PlanResponse(BaseModel):
    ops: List[ActionOp]
    raw_llm_output: str | None = None  # Keep raw output for debugging


# --- New Request/Response Models for Custom Operations ---
class CustomPlanRequest(BaseModel):
    prompt: str
    sheetData: List[List[str]]


class CustomOperation(BaseModel):
    id: str
    range: str
    type: str  # "write" | "formula" | "color"
    values: List[List[Any]] | None = None
    formula: str | None = None
    color: str | None = None
    note: str | None = None


class CustomPlanResponse(BaseModel):
    ops: List[CustomOperation]
    raw_llm_output: str | None = None


# --- API Endpoints ---
@app.get("/health")
async def health_check():
    """Simple health check endpoint for debugging CORS issues."""
    return {"status": "ok", "message": "Server is running"}


# --- MODIFIED /chat Endpoint ---
@app.post("/chat", response_model=UnifiedChatResponse) # <-- Use new response model
async def chat(request: ChatRequest):
    session_id = None # Keep track of session id
    session: Optional['Session'] = None # Ensure session is defined in scope
    try:
        print(f"\n=== Chat Endpoint === [Stateful]") # Renamed log
        print(f"Request sessionId: {request.sessionId}")
        print(f"Request message: {request.message}")

        session = get_or_create_session(request.sessionId)
        session_id = session.session_id # Store session id
        print(f"Using session: {session_id}. is_modeling: {session.is_modeling}") # Log state

        # Check 1: Are we currently in a modeling flow?
        if session.is_modeling:
            print("Session is in modeling state. Proceeding with slot-filling logic.")
            # Call the existing dialog processing function
            response_data = process_message(session, request.message)
            print(f"Slot-filling response: {response_data}")
            
            # If process_message indicates completion, reset the flag
            if response_data.get("ready"): 
                print("Modeling complete. Resetting session state.")
                session.is_modeling = False
                # Optional: Persist session change if needed for your session store
                # sessions[session.session_id] = session # For simple dict store
            
            # Return using the UnifiedChatResponse structure
            return UnifiedChatResponse(
                sessionId=response_data.get("sessionId", session_id),
                assistantMessage=response_data.get("assistantMessage"),
                slotsFilled=response_data.get("slotsFilled"),
                ready=response_data.get("ready", False) # Ensure ready has a default
            )

        # Check 2: If not modeling, does the NEW message trigger modeling?
        elif re.search(r'\bmodel\b', request.message, re.IGNORECASE):
            print("Keyword 'model' detected. Starting modeling flow.")
            session.is_modeling = True # Set the flag
            # Optional: Persist session change if needed
            # sessions[session.session_id] = session 
            
            # Call the existing dialog processing function
            response_data = process_message(session, request.message)
            print(f"Slot-filling response (initial): {response_data}")
            
            # Check if somehow the first message already filled all slots
            if response_data.get("ready"): 
                print("Modeling complete on first message. Resetting session state.")
                session.is_modeling = False
                # Optional: Persist session change if needed
                # sessions[session.session_id] = session 
            
            # Return using the UnifiedChatResponse structure
            return UnifiedChatResponse(
                sessionId=response_data.get("sessionId", session_id),
                assistantMessage=response_data.get("assistantMessage"),
                slotsFilled=response_data.get("slotsFilled"),
                ready=response_data.get("ready", False)
            )

        # Check 3: Otherwise (not modeling and no keyword), it's a direct command
        else:
            print("Neither modeling state nor keyword detected. Attempting direct action parsing.")
            # Call the function to generate ops from the message
            direct_ops_list = await generate_direct_ops(request.message)

            if direct_ops_list:
                print(f"Generated direct ops: {direct_ops_list}")
                # Validate ops (optional but recommended)
                try:
                    validated_ops = [ActionOp(**op) for op in direct_ops_list]
                    return UnifiedChatResponse(
                        sessionId=session_id,
                        directOps=[op.dict() for op in validated_ops] # Return validated ops
                    )
                except ValidationError as e:
                     print(f"ERROR: Direct ops failed Pydantic validation: {e}")
                     # Fall through to return error/message
                     return UnifiedChatResponse(
                         sessionId=session_id,
                         error="Failed to generate valid operations from the command.",
                         message="Sorry, there was an issue generating operations for that command."
                     )
            else:
                # Handle cases where the direct command wasn't understood
                print("Could not parse direct command or no ops generated.")
                return UnifiedChatResponse(
                    sessionId=session_id,
                    message="Sorry, I couldn't understand that command. Try phrasing it differently, or use the keyword 'model' for cap table analysis."
                )

    except Exception as e:
        print(f"ERROR in stateful chat endpoint: {e}")
        import traceback
        traceback.print_exc()
        # Ensure session_id is included in error response if possible
        error_session_id = session.session_id if session else (request.sessionId or "unknown")
        return UnifiedChatResponse(
             sessionId=error_session_id,
             error=f"An internal error occurred: {str(e)}"
        )

    finally:
         print("=== End Stateful Chat Endpoint ===\n")


# --- Background Task Definition ---
def run_plan_generation_task(
    task_id: str,
    slots: Dict[str, Any],
    sheetData: List[List[str]],
    selectedRangeAddress: str,
):
    """Runs the LLM plan generation and parsing in the background."""
    logger.info(f"Background task {task_id} started.")
    try:
        # --- Phase 4: Call LLM ---
        logger.info(
            f"Task {task_id}: Calling plan generation with slots: {slots}, address: {selectedRangeAddress}"
        )
        raw_output = generate_plan_raw_text(slots, sheetData, selectedRangeAddress)
        logger.info(f"Task {task_id}: LLM call completed.")

        # --- Phase 5: Parse LLM Column Mapping Result ---
        logger.info(f"Task {task_id}: Parsing LLM column mapping result.")
        # Use the correct function name here
        column_mapping = parse_column_mapping(raw_output)
        logger.info(f"Task {task_id}: Parsed column mapping: {column_mapping}")

        # --- Phase 5.5: Perform Deterministic Calculations ---
        logger.info(f"Task {task_id}: Performing deterministic calculations...")
        calculated_values = perform_cap_table_calculations(
            slots, sheetData, column_mapping
        )
        logger.info(f"Task {task_id}: Calculations complete: {calculated_values}")

        # --- Phase 6: Build Structured ActionOps ---
        logger.info(f"Task {task_id}: Building structured ActionOps.")
        # Pass the calculation results to the builder function
        final_ops_list = build_structured_ops(
            slots, sheetData, selectedRangeAddress, column_mapping, calculated_values
        )
        logger.info(f"Task {task_id}: Generated {len(final_ops_list)} ActionOps.")

        # Validate with Pydantic models
        validated_ops = [ActionOp(**op) for op in final_ops_list]
        logger.info(
            f"Task {task_id}: Successfully validated {len(validated_ops)} operations."
        )

        # Store successful result - Ensure ops are included for PreviewPane
        task_results[task_id] = {
            "status": "completed",
            "result": {
                "ops": [op.dict() for op in validated_ops],
                "raw_llm_output": raw_output,  # Keep for debugging maybe
                "slots": slots,  # Include the original slots
                "calculated_values": calculated_values,  # Include the results of perform_cap_table_calculations
                "column_mapping": column_mapping,  # Include the mapping used for calculations
            },
        }
        logger.info(
            f"Background task {task_id} completed successfully with calculated data."
        )  # Updated log message

    except Exception as e:
        logger.error(f"Background task {task_id} failed: {e}")
        import traceback

        logger.error(traceback.format_exc())
        # Store error result
        task_results[task_id] = {"status": "failed", "error": str(e)}


# --- Helper function for deterministic calculations (Implement this) ---
def perform_cap_table_calculations(
    slots: Dict, sheetData: List[List[str]], column_mapping: Dict
) -> Dict:
    """Performs cap table calculations based on slots and parsed sheet data."""
    calcs = {}
    try:
        logger.info("Starting calculations...")
        # Extract column indices with defaults
        name_idx = column_mapping.get("shareholder_name_col_idx", 0)
        shares_idx = column_mapping.get(
            "pre_round_shares_col_idx"
        )  # NO DEFAULT! Let None be None
        inv_idx = column_mapping.get("pre_round_investment_col_idx")

        # Log the indices being used
        logger.info(
            f"Using column mapping: Name={name_idx}, Shares={shares_idx}, Investment={inv_idx}"
        )

        # Extract slots values (handle potential None)
        amount = float(slots.get("amount", 0))
        pre_money = float(slots.get("preMoney", 0))
        pool_pct_decimal = float(slots.get("poolPct", 0)) / 100.0

        # 1. Sum pre-round shares from sheetData (with improved robustness)
        total_pre_round_shares = 0.0  # Use float
        parsed_investors = []  # Store parsed data for reuse
        # Add row number for logging
        for row_num, row in enumerate(sheetData):
            # Check if row is valid list
            if not row or not isinstance(row, list) or len(row) == 0:
                logger.warning(
                    f"Skipping invalid row {row_num + 1} (not a non-empty list): {row}"
                )
                continue

            # --- Safer Index Checking ---
            # Check name index validity
            if name_idx is None or not (0 <= name_idx < len(row)):
                logger.warning(
                    f"Skipping row {row_num + 1} due to invalid name_idx={name_idx} for row length {len(row)}: {row}"
                )
                continue  # Cannot proceed without a name

            # Check shares index validity (only if shares_idx is not None)
            if shares_idx is not None and not (0 <= shares_idx < len(row)):
                logger.warning(
                    f"Invalid shares_idx={shares_idx} for row length {len(row)} in row {row_num + 1}, will treat shares as 0: {row}"
                )
                # Don't skip row, just assume 0 shares if index is bad but provided
                current_shares_idx = None  # Override index for this row
            else:
                current_shares_idx = shares_idx  # Use the valid index (or None)

            # Check investment index validity (only if inv_idx is not None)
            if inv_idx is not None and not (0 <= inv_idx < len(row)):
                logger.warning(
                    f"Invalid inv_idx={inv_idx} for row length {len(row)} in row {row_num + 1}, will treat investment as 0: {row}"
                )
                current_inv_idx = None  # Override index for this row
            else:
                current_inv_idx = inv_idx  # Use the valid index (or None)
            # ---------------------------

            try:
                # Access name safely
                name_val = row[name_idx]
                name = (
                    str(name_val) if name_val is not None else f"Row {row_num + 1}"
                )  # Default name

                # Access and parse shares safely
                shares = 0.0
                if (
                    current_shares_idx is not None
                ):  # Use the potentially overridden index
                    shares_val = row[current_shares_idx]
                    if shares_val is not None and shares_val != "":
                        try:
                            shares = float(
                                str(shares_val).replace(",", "")
                            )  # Handle commas
                        except (ValueError, TypeError):
                            logger.warning(
                                f"Could not parse shares '{shares_val}' in row {row_num + 1}, using 0.0: {row}"
                            )

                total_pre_round_shares += shares

                # Access and parse investment safely
                inv = 0.0
                if current_inv_idx is not None:  # Use the potentially overridden index
                    inv_val = row[current_inv_idx]
                    if inv_val is not None and inv_val != "":
                        try:
                            # Handle currency symbols, commas etc.
                            inv_str = re.sub(r"[$,]", "", str(inv_val))
                            inv = float(inv_str)
                        except (ValueError, TypeError):
                            logger.warning(
                                f"Could not parse investment '{inv_val}' in row {row_num + 1}, using 0.0: {row}"
                            )

                parsed_investors.append(
                    {"name": name, "pre_shares": shares, "investment": inv}
                )
                # Log successful parse? Maybe too verbose.
                # logger.info(f"Successfully parsed row {row_num+1}: Name='{name}', Shares={shares}, Investment={inv}")

            except (
                Exception
            ) as e:  # Catch any other unexpected error during row processing
                logger.error(
                    f"Unexpected error processing row {row_num + 1}: {row} - {e}",
                    exc_info=True,
                )
                continue  # Skip row on unexpected error

        logger.info(f"Total pre-round shares calculated: {total_pre_round_shares}")
        logger.info(
            f"Parsed investors list: {parsed_investors}"
        )  # Log the list *after* the loop

        # 2. Calculate core round values
        calcs["post_money_valuation"] = pre_money + amount
        calcs["price_per_share"] = (
            pre_money / total_pre_round_shares if total_pre_round_shares > 0 else 0
        )
        calcs["total_new_shares_for_round"] = (
            amount / calcs["price_per_share"] if calcs["price_per_share"] > 0 else 0
        )

        total_post_money_shares_before_pool = (
            total_pre_round_shares + calcs["total_new_shares_for_round"]
        )

        # 3. Calculate option pool shares (using post-money formula)
        if pool_pct_decimal > 0 and pool_pct_decimal < 1:
            total_post_money_shares_after_pool_target = (
                total_post_money_shares_before_pool / (1.0 - pool_pct_decimal)
            )
            calcs["option_pool_shares"] = (
                total_post_money_shares_after_pool_target
                - total_post_money_shares_before_pool
            )
        else:
            calcs["option_pool_shares"] = 0
            total_post_money_shares_after_pool_target = (
                total_post_money_shares_before_pool
            )

        total_post_money_shares_after_pool = (
            total_post_money_shares_before_pool + calcs["option_pool_shares"]
        )
        calcs["total_post_money_shares"] = (
            total_post_money_shares_after_pool  # Store total for convenience
        )

        # 4. Calculate final share counts and ownership percentages
        final_share_counts = {}
        final_ownership_pct = {}

        for inv in parsed_investors:
            name = inv["name"]
            final_share_counts[name] = inv["pre_shares"]  # Start with pre-round shares
            final_ownership_pct[name] = (
                (inv["pre_shares"] / total_post_money_shares_after_pool)
                if total_post_money_shares_after_pool > 0
                else 0
            )

        final_share_counts["New Investors"] = calcs["total_new_shares_for_round"]
        final_ownership_pct["New Investors"] = (
            (calcs["total_new_shares_for_round"] / total_post_money_shares_after_pool)
            if total_post_money_shares_after_pool > 0
            else 0
        )

        final_share_counts["Option Pool"] = calcs["option_pool_shares"]
        final_ownership_pct["Option Pool"] = (
            (calcs["option_pool_shares"] / total_post_money_shares_after_pool)
            if total_post_money_shares_after_pool > 0
            else 0
        )

        calcs["final_share_counts"] = final_share_counts
        calcs["final_ownership_pct"] = final_ownership_pct
        calcs["parsed_investors"] = parsed_investors  # Pass this along too

        logger.info("Calculations finished successfully.")

    except Exception as e:
        logger.error(f"Error during deterministic calculations: {e}", exc_info=True)
        # Return empty or partial dictionary on error?
        return {}  # Return empty for now

    return calcs


# --- Helper function to build ops (Update signature) ---
def build_structured_ops(
    slots: Dict,
    sheetData: List[List[str]],
    selectedRangeAddress: str,
    column_mapping: Dict,
    calculated_values: Dict,
) -> List[Dict]:
    """Deterministically builds the ActionOp list for the structured output."""
    ops = []
    op_id_counter = 1

    # Get column indices (with defaults if mapping is incomplete/missing)
    name_idx = column_mapping.get("shareholder_name_col_idx", 0)  # Default to 0
    shares_idx = column_mapping.get("pre_round_shares_col_idx", 1)  # Default to 1
    inv_idx = column_mapping.get("pre_round_investment_col_idx")  # Default to None
    logger.info(
        f"Using column mapping: Name={name_idx}, Shares={shares_idx}, Investment={inv_idx}"
    )

    def get_op_id():
        nonlocal op_id_counter
        op_id = f"op-{op_id_counter}"
        op_id_counter += 1
        return op_id

    # Helper to convert column letter to number (A=1)
    def col_to_num(col_str):
        num = 0
        for char in col_str:
            num = num * 26 + (ord(char.upper()) - ord("A")) + 1
        return num

    # Helper to convert column number to letter (1=A)
    def num_to_col(n):
        string = ""
        while n > 0:
            n, remainder = divmod(n - 1, 26)
            string = chr(65 + remainder) + string
        return string

    try:
        # --- 1. Parse Address & Calculate Output Start ---
        logger.info(f"Parsing address: {selectedRangeAddress}")
        # Remove sheet name if present (e.g., "Sheet1!A1:B4" -> "A1:B4")
        address_part = selectedRangeAddress.split("!")[-1]
        # Basic regex for A1 or A1:B4 formats
        match = re.match(r"([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?", address_part)
        if not match:
            raise ValueError(f"Could not parse address part: {address_part}")

        start_col_str, start_row_str, end_col_str, end_row_str = match.groups()
        start_row = int(start_row_str)
        end_col_str = end_col_str or start_col_str  # Handle single cell selection

        end_col_num = col_to_num(end_col_str)
        output_start_col_num = end_col_num + 2  # Start 2 columns right
        output_start_col_letter = num_to_col(output_start_col_num)
        output_start_row = start_row
        current_row = output_start_row

        logger.info(
            f"Input ends at col {end_col_str}({end_col_num}). Output starts at col {output_start_col_letter}({output_start_col_num}), row {output_start_row}"
        )

        # --- 2. Generate Ops for Round Inputs ---
        input_col1 = output_start_col_letter
        input_col2 = num_to_col(output_start_col_num + 1)

        ops.append(
            {
                "id": get_op_id(),
                "range": f"{input_col1}{current_row}",
                "type": "write",
                "values": [["Round Inputs"]],
                "note": "Header",
            }
        )
        current_row += 1
        ops.append(
            {
                "id": get_op_id(),
                "range": f"{input_col1}{current_row}",
                "type": "write",
                "values": [["Round Type"]],
                "note": "Input Label",
            }
        )
        ops.append(
            {
                "id": get_op_id(),
                "range": f"{input_col2}{current_row}",
                "type": "write",
                "values": [[str(slots.get("roundType", ""))]],
                "note": "Input Value",
            }
        )
        current_row += 1
        ops.append(
            {
                "id": get_op_id(),
                "range": f"{input_col1}{current_row}",
                "type": "write",
                "values": [["Amount ($M)"]],
                "note": "Input Label",
            }
        )
        ops.append(
            {
                "id": get_op_id(),
                "range": f"{input_col2}{current_row}",
                "type": "write",
                "values": [
                    [slots.get("amount") / 1000000 if slots.get("amount") else None]
                ],
                "note": "Input Value ($M)",
            }
        )
        current_row += 1
        ops.append(
            {
                "id": get_op_id(),
                "range": f"{input_col1}{current_row}",
                "type": "write",
                "values": [["Pre-Money ($M)"]],
                "note": "Input Label",
            }
        )
        ops.append(
            {
                "id": get_op_id(),
                "range": f"{input_col2}{current_row}",
                "type": "write",
                "values": [
                    [slots.get("preMoney") / 1000000 if slots.get("preMoney") else None]
                ],
                "note": "Input Value ($M)",
            }
        )
        current_row += 1
        ops.append(
            {
                "id": get_op_id(),
                "range": f"{input_col1}{current_row}",
                "type": "write",
                "values": [["Pool Pct (%)"]],
                "note": "Input Label",
            }
        )
        ops.append(
            {
                "id": get_op_id(),
                "range": f"{input_col2}{current_row}",
                "type": "write",
                "values": [[slots.get("poolPct")]],
                "note": "Input Value (%)",
            }
        )
        current_row += 2  # Skip a row

        # --- 3. Generate Ops for Calculations ---
        calc_col1 = output_start_col_letter
        calc_col2 = num_to_col(output_start_col_num + 1)

        ops.append(
            {
                "id": get_op_id(),
                "range": f"{calc_col1}{current_row}",
                "type": "write",
                "values": [["Calculations"]],
                "note": "Header",
            }
        )
        current_row += 1
        ops.append(
            {
                "id": get_op_id(),
                "range": f"{calc_col1}{current_row}",
                "type": "write",
                "values": [["Post-Money ($M)"]],
                "note": "Calc Label",
            }
        )
        # Use calculated value from LLM, convert to $M
        pmv = calculated_values.get("post_money_valuation")
        pmv_m = pmv / 1000000 if pmv else None
        ops.append(
            {
                "id": get_op_id(),
                "range": f"{calc_col2}{current_row}",
                "type": "write",
                "values": [[pmv_m]],
                "note": "Calc Value ($M)",
            }
        )
        current_row += 1
        ops.append(
            {
                "id": get_op_id(),
                "range": f"{calc_col1}{current_row}",
                "type": "write",
                "values": [["Price per Share"]],
                "note": "Calc Label",
            }
        )
        # Use calculated value from LLM
        pps = calculated_values.get("price_per_share")
        ops.append(
            {
                "id": get_op_id(),
                "range": f"{calc_col2}{current_row}",
                "type": "write",
                "values": [[pps]],
                "note": "Calc Value",
            }
        )
        current_row += 2  # Skip a row

        # --- 4. Generate Ops for Cap Table Headers ---
        cap_table_start_row = current_row
        header_col1 = output_start_col_letter
        header_col2 = num_to_col(output_start_col_num + 1)
        header_col3 = num_to_col(output_start_col_num + 2)
        header_col4 = num_to_col(output_start_col_num + 3)

        ops.append(
            {
                "id": get_op_id(),
                "range": f"{header_col1}{current_row}",
                "type": "write",
                "values": [["Post-Money Cap Table"]],
                "note": "Header",
            }
        )
        current_row += 1
        ops.append(
            {
                "id": get_op_id(),
                "range": f"{header_col1}{current_row}:{header_col4}{current_row}",  # Merge header range? LLM needs to know merge or just write
                "type": "write",
                "values": [["Shareholder", "Investment ($)", "Shares", "% Ownership"]],
                "note": "Table Headers",
            }
        )
        current_row += 1

        # --- 5. Generate Ops for Cap Table Data ---
        share_counts = calculated_values.get("final_share_counts", {})
        ownership_pct = calculated_values.get("final_ownership_pct", {})
        # Get parsed investors list (which contains pre-round info needed)
        parsed_investors = calculated_values.get("parsed_investors", [])

        # Write rows for existing investors
        for investor_data in parsed_investors:
            name = investor_data["name"]
            # Use pre-round investment parsed from sheet
            investment = investor_data["investment"]
            final_shares = share_counts.get(name)
            final_pct = ownership_pct.get(name)

            ops.append(
                {
                    "id": get_op_id(),
                    "range": f"{header_col1}{current_row}",
                    "type": "write",
                    "values": [[name]],
                }
            )
            ops.append(
                {
                    "id": get_op_id(),
                    "range": f"{header_col2}{current_row}",
                    "type": "write",
                    "values": [[investment]],
                }
            )
            ops.append(
                {
                    "id": get_op_id(),
                    "range": f"{header_col3}{current_row}",
                    "type": "write",
                    "values": [[final_shares]],
                }
            )
            # Write percentage as a number, Excel can format it
            ops.append(
                {
                    "id": get_op_id(),
                    "range": f"{header_col4}{current_row}",
                    "type": "write",
                    "values": [[final_pct]],
                    "note": "Ownership Pct",
                }
            )
            current_row += 1

        # Write row for New Investors
        new_inv_shares = share_counts.get("New Investors")
        new_inv_pct = ownership_pct.get("New Investors")
        ops.append(
            {
                "id": get_op_id(),
                "range": f"{header_col1}{current_row}",
                "type": "write",
                "values": [["New Investors"]],
            }
        )
        # Use investment amount from slots
        ops.append(
            {
                "id": get_op_id(),
                "range": f"{header_col2}{current_row}",
                "type": "write",
                "values": [[float(slots.get("amount", 0))]],
            }
        )
        ops.append(
            {
                "id": get_op_id(),
                "range": f"{header_col3}{current_row}",
                "type": "write",
                "values": [[new_inv_shares]],
            }
        )
        ops.append(
            {
                "id": get_op_id(),
                "range": f"{header_col4}{current_row}",
                "type": "write",
                "values": [[new_inv_pct]],
                "note": "Ownership Pct",
            }
        )
        current_row += 1

        # Write row for Option Pool
        pool_shares = share_counts.get("Option Pool")
        pool_pct = ownership_pct.get("Option Pool")
        ops.append(
            {
                "id": get_op_id(),
                "range": f"{header_col1}{current_row}",
                "type": "write",
                "values": [["Option Pool"]],
            }
        )
        # Option pool has no explicit investment amount
        ops.append(
            {
                "id": get_op_id(),
                "range": f"{header_col2}{current_row}",
                "type": "write",
                "values": [[None]],
            }
        )  # Or 0?
        ops.append(
            {
                "id": get_op_id(),
                "range": f"{header_col3}{current_row}",
                "type": "write",
                "values": [[pool_shares]],
            }
        )
        ops.append(
            {
                "id": get_op_id(),
                "range": f"{header_col4}{current_row}",
                "type": "write",
                "values": [[pool_pct]],
                "note": "Ownership Pct",
            }
        )
        current_row += 1

        # --- 6. Generate Ops for Totals ---
        total_row = current_row
        ops.append(
            {
                "id": get_op_id(),
                "range": f"{header_col1}{total_row}",
                "type": "write",
                "values": [["Total"]],
                "note": "Total Label",
            }
        )
        # Sum Investment
        ops.append(
            {
                "id": get_op_id(),
                "range": f"{header_col2}{total_row}",
                "type": "formula",
                "formula": f"=SUM({header_col2}{cap_table_start_row + 2}:{header_col2}{total_row - 1})",
                "note": "Sum Investment",
            }
        )
        # Sum Shares
        ops.append(
            {
                "id": get_op_id(),
                "range": f"{header_col3}{total_row}",
                "type": "formula",
                "formula": f"=SUM({header_col3}{cap_table_start_row + 2}:{header_col3}{total_row - 1})",
                "note": "Sum Shares",
            }
        )
        # Sum Percentage
        ops.append(
            {
                "id": get_op_id(),
                "range": f"{header_col4}{total_row}",
                "type": "formula",
                "formula": f"=SUM({header_col4}{cap_table_start_row + 2}:{header_col4}{total_row - 1})",
                "note": "Sum Percentage",
            }
        )

        logger.info(f"Finished generating {len(ops)} operations.")

    except Exception as e:
        logger.error(f"Error during structured op generation: {e}", exc_info=True)
        # Return empty list or raise specific error?
        ops = []  # Return empty on error for now

    return ops


# --- Placeholder for direct command parsing function ---
# Replace placeholder with call to the actual implementation in model.py
async def generate_direct_ops(message: str) -> List[Dict]:
    """Calls the model module to parse the direct command into ActionOps."""
    # TODO: Potentially make parse_direct_command_to_ops async if LLM call becomes async
    # For now, assuming the LlamaCPP interface is synchronous from FastAPI's perspective
    logger.info(f"Calling model.parse_direct_command_to_ops for: '{message}'")
    try:
        ops_list = parse_direct_command_to_ops(message)
        logger.info(f"Received {len(ops_list)} ops from model.parse_direct_command_to_ops")
        return ops_list
    except Exception as e:
        logger.error(f"Error calling parse_direct_command_to_ops: {e}", exc_info=True)
        return [] # Return empty list on error


@app.post("/plan")
async def plan_endpoint(
    request: PlanRequest, background_tasks: BackgroundTasks
):  # Inject BackgroundTasks
    logger.info("=== Plan Endpoint Hit ===")
    try:
        # Log the received sheet data for debugging
        logger.info(f"Received sheet data for plan generation:")
        logger.info(json.dumps(request.sheetData, indent=2))

        # Generate a task ID
        task_id = str(uuid.uuid4())
        logger.info(f"Generated task ID: {task_id}")

        # Initialize task status
        task_results[task_id] = {"status": "processing"}

        # Add the long-running job to background tasks
        background_tasks.add_task(
            run_plan_generation_task,
            task_id,
            request.slots,
            request.sheetData,
            request.selectedRangeAddress,
        )

        # Return 202 Accepted with the task ID
        return JSONResponse(
            status_code=202, content={"status": "processing", "task_id": task_id}
        )

    except ValidationError as e:  # Catch Pydantic validation errors specifically
        logger.error(f"Validation Error for /plan request: {e.errors()}")
        raise HTTPException(
            status_code=422,  # Use 422 for validation errors
            detail=e.errors(),
        )
    except FileNotFoundError as e:  # Assuming generate_plan... might raise this
        logger.error(f"ERROR: Model file not found - {e}")
        raise HTTPException(status_code=500, detail=str(e))
    except (
        ValueError,
        TypeError,
    ) as parse_error:  # Catch parsing/validation errors from parse_llm_output_to_ops
        logger.error(f"ERROR: Failed to parse or validate LLM output - {parse_error}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to parse/validate plan from LLM: {parse_error}",
        )
    except Exception as e:
        logger.error(f"ERROR: Unexpected error in /plan endpoint - {e}")
        import traceback

        logger.error(traceback.format_exc())  # Log full traceback for unexpected errors
        raise HTTPException(
            status_code=500, detail=f"Unexpected error processing plan request: {e}"
        )


# --- Result Retrieval Endpoint ---
@app.get("/plan/result/{task_id}")
async def get_plan_result(task_id: str):
    logger.info(f"Polling for result of task_id: {task_id}")
    result = task_results.get(task_id)
    if not result:
        logger.warning(f"Task ID {task_id} not found.")
        raise HTTPException(status_code=404, detail="Task ID not found")

    logger.info(f"Returning status for task {task_id}: {result.get('status')}")
    if result["status"] == "completed":
        # Clear result after retrieval? Optional.
        # task_results.pop(task_id, None)
        pass  # Keep result for potential re-polling or inspection
    elif result["status"] == "failed":
        # Clear result after retrieval? Optional.
        # task_results.pop(task_id, None)
        pass  # Keep result for potential re-polling or inspection

    return result


# --- New Endpoints for Custom Operations ---
@app.post("/custom-plan", response_model=CustomPlanResponse)
def custom_plan_endpoint(request: CustomPlanRequest):
    """
    Generate a plan with custom operations based on user prompts.
    This is a synchronous version that directly returns the result.
    """
    try:
        logger.info("=== Custom Plan Endpoint Hit ===")
        logger.info(f"Prompt: {request.prompt}")
        logger.info(f"Received sheet data length: {len(request.sheetData)}")

        # Generate raw text using imported function from model.py
        raw_output = generate_custom_plan_raw_text(request.prompt, request.sheetData)
        logger.info("Raw LLM output generated successfully")

        # Parse the LLM output using imported function from model.py
        operations = parse_custom_llm_output_to_ops(raw_output)
        logger.info(f"Parsed {len(operations)} operations")

        # Convert to Pydantic models
        validated_ops = [CustomOperation(**op) for op in operations]
        logger.info(f"Validated {len(validated_ops)} operations")

        # Return the response
        return CustomPlanResponse(
            ops=validated_ops,
            raw_llm_output=raw_output  # Include raw output for debugging
        )

    except ValidationError as e:
        logger.error(f"Validation Error for /custom-plan request: {e.errors()}")
        raise HTTPException(status_code=422, detail=e.errors())
    except FileNotFoundError as e:
        logger.error(f"ERROR: Model file not found - {e}")
        raise HTTPException(status_code=500, detail=str(e))
    except ValueError as e:
        logger.error(f"ERROR: Value error - {e}")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"ERROR: Unexpected error in /custom-plan endpoint - {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Unexpected error: {e}")


# --- Main Execution (for development) ---
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
        timeout_keep_alive=310,  # Set keep-alive slightly longer than frontend timeout (e.g., 310 seconds)
    )

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ValidationError
from typing import List, Any, Optional, Dict
from pathlib import Path
import logging
import json
import uuid
from fastapi.responses import JSONResponse

# Import LLM functions
from model import generate_plan_raw_text, get_llm, parse_llm_output_to_ops
from dialogs import get_or_create_session, process_message

app = FastAPI()

logger = logging.getLogger("uvicorn")

# --- Simple In-Memory Storage for Task Results (Replace with DB/Redis for production) ---
task_results: Dict[str, Dict] = {}

# --- Load LLM on startup (optional, but recommended) ---
@app.on_event("startup")
async def startup_event():
    try:
        get_llm() # Initialize and load the LLM
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

class ChatResponse(BaseModel):
    sessionId: str
    assistantMessage: str
    slotsFilled: dict
    ready: bool

class PlanRequest(BaseModel):
    # prompt: str # Remove requirement for prompt
    # sheet: List[List[str]] # Sheet data will be included
    slots: Dict[str, Any] # Expect the collected slots
    sheetData: List[List[str]] # Expect the sheet data from selected range

class ActionOp(BaseModel):
    id: str
    range: str
    type: str # "write" | "formula"
    values: List[List[Any]] | None = None # Allow Any in values
    formula: str | None = None
    note: str | None = None

class PlanResponse(BaseModel):
    ops: List[ActionOp]
    raw_llm_output: str | None = None # Keep raw output for debugging

# --- API Endpoints ---
@app.get("/health")
async def health_check():
    """Simple health check endpoint for debugging CORS issues."""
    return {"status": "ok", "message": "Server is running"}

@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """
    Handles the chat interaction and slot filling process.
    """
    try:
        print(f"\n=== Chat Endpoint ===")
        print(f"Request sessionId: {request.sessionId}")
        print(f"Request message: {request.message}")
        
        # Get or create session
        session = get_or_create_session(request.sessionId)
        print(f"Using session: {session.session_id}")
        print(f"Current slots: {session.slots}")
        
        # Process the message and get response
        response = process_message(session, request.message)
        
        print(f"Response sessionId: {response['sessionId']}")
        print(f"Response slots: {response['slotsFilled']}")
        print("=== End Chat Endpoint ===\n")
        
        return response
    except Exception as e:
        print(f"ERROR in chat endpoint: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# --- Background Task Definition ---
def run_plan_generation_task(task_id: str, slots: Dict[str, Any], sheetData: List[List[str]]):
    """Runs the LLM plan generation and parsing in the background."""
    logger.info(f"Background task {task_id} started.")
    try:
        # --- Phase 4: Call LLM --- 
        logger.info(f"Task {task_id}: Calling plan generation with slots: {slots}")
        # Note: generate_plan_raw_text should ideally be synchronous if llama.cpp is blocking
        raw_output = generate_plan_raw_text(slots, sheetData) 
        logger.info(f"Task {task_id}: LLM call completed.")
        
        # --- Phase 5: Parse LLM Output --- 
        logger.info(f"Task {task_id}: Parsing LLM output.")
        parsed_op_dicts = parse_llm_output_to_ops(raw_output)
        # Validate with Pydantic models
        validated_ops = [ActionOp(**op) for op in parsed_op_dicts]
        logger.info(f"Task {task_id}: Successfully validated {len(validated_ops)} operations.")
        
        # Store successful result
        task_results[task_id] = {
            "status": "completed", 
            "result": {"ops": [op.dict() for op in validated_ops], "raw_llm_output": raw_output}
        }
        logger.info(f"Background task {task_id} completed successfully.")

    except Exception as e:
        logger.error(f"Background task {task_id} failed: {e}")
        import traceback
        logger.error(traceback.format_exc())
        # Store error result
        task_results[task_id] = {"status": "failed", "error": str(e)}

@app.post("/plan")
async def plan_endpoint(request: PlanRequest, background_tasks: BackgroundTasks): # Inject BackgroundTasks
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
        background_tasks.add_task(run_plan_generation_task, task_id, request.slots, request.sheetData)

        # Return 202 Accepted with the task ID
        return JSONResponse(
            status_code=202,
            content={"status": "processing", "task_id": task_id}
        )

    except ValidationError as e: # Catch Pydantic validation errors specifically
        logger.error(f"Validation Error for /plan request: {e.errors()}")
        raise HTTPException(
            status_code=422, # Use 422 for validation errors
            detail=e.errors()
        )
    except FileNotFoundError as e: # Assuming generate_plan... might raise this
        logger.error(f"ERROR: Model file not found - {e}")
        raise HTTPException(status_code=500, detail=str(e))
    except (ValueError, TypeError) as parse_error: # Catch parsing/validation errors from parse_llm_output_to_ops
        logger.error(f"ERROR: Failed to parse or validate LLM output - {parse_error}")
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to parse/validate plan from LLM: {parse_error}"
        )
    except Exception as e:
        logger.error(f"ERROR: Unexpected error in /plan endpoint - {e}")
        import traceback
        logger.error(traceback.format_exc()) # Log full traceback for unexpected errors
        raise HTTPException(status_code=500, detail=f"Unexpected error processing plan request: {e}")

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
        pass # Keep result for potential re-polling or inspection
    elif result["status"] == "failed":
        # Clear result after retrieval? Optional.
        # task_results.pop(task_id, None)
        pass # Keep result for potential re-polling or inspection
        
    return result

# --- Main Execution (for development) ---
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
        timeout_keep_alive=310 # Set keep-alive slightly longer than frontend timeout (e.g., 310 seconds)
    ) 
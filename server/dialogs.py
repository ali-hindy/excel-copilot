from typing import Dict, List, Optional
import uuid
from pydantic import BaseModel
import json
from model import get_llm

# --- Session Management ---
sessions: Dict[str, 'Session'] = {}

class Session(BaseModel):
    session_id: str
    slots: Dict[str, Optional[str]] = {
        "roundType": None,
        "amount": None,
        "preMoney": None,
        "poolPct": None
    }
    history: List[Dict[str, str]] = []
    last_prompted_slot: Optional[str] = None

    def __init__(self, **data):
        if 'session_id' not in data:
            data['session_id'] = str(uuid.uuid4())
        super().__init__(**data)

def get_or_create_session(session_id: Optional[str] = None) -> Session:
    if session_id and session_id in sessions:
        return sessions[session_id]
    
    session = Session()
    sessions[session.session_id] = session
    return session

# --- Prompts ---
SLOT_EXTRACTION_PROMPT = """
[INST] You are a JSON generation machine.
Your ONLY task is to extract slot values from the LATEST user message and return a valid JSON object.
Do NOT include any explanations, greetings, or conversational text.
Your response MUST start with {{ and end with }}.

The slots to extract are: roundType, amount, preMoney, poolPct.

Current Slots:
{slots}

Conversation History:
{history}

Assistant's Last Question asked for slot: '{last_prompted_slot}'

LATEST User Message: "{latest_message}"

INSTRUCTIONS:
1. Analyze ONLY the LATEST user message.
2. If the user message seems to answer the Assistant's Last Question (for slot '{last_prompted_slot}'), prioritize extracting the value for that specific slot.
3. Otherwise, extract any other slot values EXPLICITLY mentioned.
4. For 'amount' and 'preMoney', extract numeric value (e.g., 5000000).
5. For 'poolPct', extract numeric value (e.g., 10).
6. Return ONLY the JSON object.
7. If no new information is found, return an empty JSON object: {{}}.

Example 1 (Assistant asked for 'amount', User says "$5M"):
{{\"amount\": 5000000}}

Example 2 (Assistant asked for 'preMoney', User says "20 million"):
{{\"preMoney\": 20000000}}

Example 3 (User says "Series A"):
{{\"roundType\": \"Series A\"}}

Example 4 (Assistant asked for 'amount', User says "hello"):
{{}}

Generate the JSON output based ONLY on the LATEST User Message, prioritizing the '{last_prompted_slot}' slot if relevant. [/INST]
"""

def extract_slots_from_message(message: str, session: Session) -> Dict[str, str]:
    """Use LLM to extract slot values from the message."""
    try: # Outer try for the whole function
        llm = get_llm()
        
        # Format the prompt with current context
        history_str = "\n".join([f"{msg['role']}: {msg['message']}" for msg in session.history])
        slots_str = json.dumps(session.slots, indent=2)
        latest_message = session.history[-1]['message'] if session.history and session.history[-1]['role'] == 'user' else message
        
        # Try formatting the prompt separately
        try:
            prompt = SLOT_EXTRACTION_PROMPT.format(
                history=history_str,
                slots=slots_str,
                last_prompted_slot=session.last_prompted_slot or "None",
                latest_message=latest_message
            )
        except KeyError as fmt_ke:
            print(f"ERROR during prompt formatting: {fmt_ke}")
            print(f"History string: {history_str}")
            print(f"Slots string: {slots_str}")
            raise # Re-raise
        except Exception as fmt_e:
            print(f"ERROR during prompt formatting (other): {fmt_e}")
            raise # Re-raise
        
        print(">>> Calling LLM for slot extraction...") # Debug print
        # Specific try for LLM call
        try:
            response = llm.create_completion(
                prompt=prompt,
                max_tokens=200,
                temperature=0.1,
                stop=["```", "[/INST]"],
                echo=False
            )
            print(f"<<< LLM call successful. Raw response text: {response['choices'][0]['text']}") # Debug print
        except Exception as llm_e:
            print(f"ERROR during LLM call in extract_slots_from_message: {llm_e}")
            raise # Re-raise the exception to be caught by the endpoint

        # Specific try for response processing and JSON parsing
        try:
            print(">>> Processing LLM response for slots...") # Debug print
            raw_llm_text = response["choices"][0]["text"].strip()
            json_str = raw_llm_text

            # Attempt 1: Direct parsing (assuming LLM behaves)
            try:
                extracted_slots_raw = json.loads(json_str)
                print("Direct JSON parse successful.")
            except json.JSONDecodeError as e:
                print(f"Direct JSON parse failed: {e}. Trying fallback extraction...")
                # Attempt 2: Fallback - Find first { and last }
                start_brace = raw_llm_text.find('{')
                end_brace = raw_llm_text.rfind('}')
                if start_brace != -1 and end_brace != -1 and end_brace > start_brace:
                    json_str_fallback = raw_llm_text[start_brace : end_brace + 1]
                    try:
                        extracted_slots_raw = json.loads(json_str_fallback)
                        print("Fallback JSON extraction successful.")
                    except json.JSONDecodeError as e2:
                        print(f"Fallback JSON parse also failed: {e2}")
                        print(f"Original LLM Text: {raw_llm_text}")
                        print(f"Extracted Substring: {json_str_fallback}")
                        return {} # Return empty dict if fallback fails
                else: # This block corresponds to the outer if
                    print("Could not find JSON object braces in LLM response.")
                    print(f"Original LLM Text: {raw_llm_text}")
                    return {} # Return empty dict if braces not found
            # End of try-except for direct parsing / fallback
            
            # Check if extracted_slots_raw was successfully assigned
            if 'extracted_slots_raw' not in locals():
                print("Error: extracted_slots_raw not assigned after parsing attempts.")
                return {}
            
            # --- Post-Parsing Logic --- 
            if not isinstance(extracted_slots_raw, dict):
                print(f"Warning: LLM returned non-dict JSON: {json_str}") # Use original json_str for logging if needed
                return {}

            # Clean keys (remove surrounding quotes if any)
            extracted_slots = {}
            for k, v in extracted_slots_raw.items():
                cleaned_key = k.strip()
                if cleaned_key.startswith('"') and cleaned_key.endswith('"'):
                    cleaned_key = cleaned_key[1:-1]
                elif cleaned_key.startswith("'") and cleaned_key.endswith("'"):
                         cleaned_key = cleaned_key[1:-1]
                extracted_slots[cleaned_key] = v

            print(f"Extracted slots after cleaning: {extracted_slots}") # Debug print
            return extracted_slots
            
        except Exception as proc_e:
            print(f"Warning: Unexpected error processing LLM response in extract_slots: {str(proc_e)}")
            return {}
            
    except Exception as outer_e:
        print(f"ERROR in extract_slots_from_message function: {outer_e}")
        # Ensure we don't mask the original error if it came from the LLM call
        if 'llm_e' in locals() and outer_e is llm_e:
            raise
        else:
             # If it's a different error, wrap it or just return empty
             print(f"Returning empty dict due to error: {outer_e}")
             return {}

def process_message(session: Session, message: str) -> Dict:
    # Add user message to history
    session.history.append({"role": "user", "message": message})
    
    # Extract any new slot values
    extracted_slots = extract_slots_from_message(message, session)
    
    # Update session slots with any new values
    for key, value in extracted_slots.items():
        # Ensure the key exists in the session slots before updating
        if key in session.slots and value is not None:
            session.slots[key] = value
    
    # --- Determine next state --- 
    all_slots_filled = all(session.slots.get(key) is not None for key in session.slots)

    response_message = ""
    next_prompted_slot = None # Track what the next question is about

    if all_slots_filled:
        response_message = "Thanks! All parameters collected. Ready to generate the plan."
        session.last_prompted_slot = None # Clear prompted slot when ready
    else:
        # --- Deterministic Question Logic --- 
        slot_order = ["roundType", "amount", "preMoney", "poolPct"]
        for slot_key in slot_order:
            if session.slots.get(slot_key) is None:
                next_prompted_slot = slot_key
                # Generate question based on the missing slot
                if slot_key == "roundType":
                    response_message = "What is the round type? (e.g., Series A, Seed)"
                elif slot_key == "amount":
                    response_message = "What is the investment amount? (e.g., $5M)"
                elif slot_key == "preMoney":
                    response_message = "What is the pre-money valuation? (e.g., $20M)"
                elif slot_key == "poolPct":
                    response_message = "What is the option pool percentage? (e.g., 10%)"
                else:
                    # Fallback shouldn't be reached with current slots
                    response_message = "Sorry, I need more information."
                    print(f"Warning: Fell through deterministic question logic for key: {slot_key}")
                break # Found the first missing slot, stop looking
        
        if not next_prompted_slot:
            # This case should ideally not happen if all_slots_filled is false,
            # but handle it defensively.
            print("Warning: No missing slot found despite all_slots_filled being false.")
            response_message = "Something seems off. Could you please clarify your request?"
            session.last_prompted_slot = None
        else:
             # Store the slot we are about to prompt for
             session.last_prompted_slot = next_prompted_slot 

    # Add assistant response to history
    session.history.append({"role": "assistant", "message": response_message})

    return {
        "assistantMessage": response_message,
        "slotsFilled": session.slots,
        "ready": all_slots_filled,
        "sessionId": session.session_id,
    } 
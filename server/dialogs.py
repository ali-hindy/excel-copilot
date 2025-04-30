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

LATEST User Message: "{latest_message}"

INSTRUCTIONS:
1. Analyze ONLY the LATEST user message.
2. Extract values EXPLICITLY mentioned. DO NOT GUESS.
3. For 'amount' and 'preMoney', extract numeric value (e.g., 5000000).
4. For 'poolPct', extract numeric value (e.g., 10).
5. Return ONLY the JSON object.
6. If no new information is found, return an empty JSON object: {{}}.

Example 1 (User says "$5M"):
{{\"amount\": 5000000}}

Example 2 (User says "Series A"):
{{\"roundType\": \"Series A\"}}

Example 3 (User says "hello"):
{{}}

Generate the JSON output based ONLY on the LATEST User Message. [/INST]
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

NEXT_QUESTION_PROMPT = """[INST] You are an Excel Cap-Table AI assistant helping to collect information for a funding round.

Current conversation history:
{history}

Current slot values:
{slots}

Based on the conversation and current slot values, ask exactly one question to get the next missing piece of information. Only ask about one missing slot at a time.

Example response:
What is the pre-money valuation? (e.g., $20M)
[/INST]
"""

def get_next_question(session: Session) -> str:
    """Use LLM to determine the next question to ask."""
    try: # Outer try for the whole function
        llm = get_llm()
        
        # Format the prompt with current context
        history_str = "\n".join([f"{msg['role']}: {msg['message']}" for msg in session.history])
        slots_str = json.dumps(session.slots, indent=2)
        
        prompt = NEXT_QUESTION_PROMPT.format(
            history=history_str,
            slots=slots_str
        )
        
        # Specific try for LLM call
        try:
            response = llm.create_completion(
                prompt=prompt,
                max_tokens=100,
                temperature=0.1,
                stop=["[/INST]"],
                echo=False
            )
        except Exception as llm_e:
            print(f"ERROR during LLM call in get_next_question: {llm_e}")
            raise # Re-raise the exception

        # Specific try for response processing
        try:
            return response["choices"][0]["text"].strip()
        except Exception as proc_e:
            print(f"Warning: Unexpected error processing LLM response in get_next_question: {str(proc_e)}")
            return "Sorry, I encountered an error determining the next question." # Return a fallback message

    except Exception as outer_e:
        print(f"ERROR in get_next_question function: {outer_e}")
        # Ensure we don't mask the original error if it came from the LLM call
        if 'llm_e' in locals() and outer_e is llm_e:
            raise
        else:
            print(f"Returning fallback question due to error: {outer_e}")
            return "Sorry, I encountered an error. Could you please repeat your last input?" # Fallback

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
    
    # Get the next question
    assistant_message = get_next_question(session)
    
    # Add assistant message to history
    session.history.append({"role": "assistant", "message": assistant_message})
    
    # Check if all slots are filled
    all_slots_filled = all(value is not None for value in session.slots.values())
    
    return {
        "sessionId": session.session_id,
        "assistantMessage": assistant_message,
        "slotsFilled": session.slots,
        "ready": all_slots_filled
    } 
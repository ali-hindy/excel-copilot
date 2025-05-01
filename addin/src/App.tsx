import React, { useState, useEffect, useRef } from "react";
import { ChatView, ChatMessage } from "./components/ChatView";
import { PreviewPane } from "./components/PreviewPane";
import { SheetConnector, ActionOp, RangeFormatting } from "./SheetConnector";
import { ChatService, ChatResponse } from "./services/chatService";

// Interface for backend result structure - UPDATED
interface BackendPlanResult {
  ops: ActionOp[];
  raw_llm_output?: string;
  slots: any; // Add type if known
  calculated_values: any; // Add type if known
  column_mapping: any; // Add type if known
}

// Interface for the final combined data needed for applying the formatted plan
interface FinalPlanData {
  backendResult: BackendPlanResult;
  formatting: RangeFormatting;
}

export default function App() {
  const [slots, setSlots] = useState<any>({
    roundType: undefined,
    amount: undefined,
    preMoney: undefined,
    poolPct: undefined,
  });
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', message: 'Hello! How can I help you model your cap table today? (e.g., \"Model Series A\")' }
  ]);
  const [planOps, setPlanOps] = useState<ActionOp[]>([]);
  const [selectedRangeAddress, setSelectedRangeAddress] = useState<string | null>(null);
  const [planTaskId, setPlanTaskId] = useState<string | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [capturedFormatting, setCapturedFormatting] = useState<RangeFormatting | null>(null);
  const [finalPlanData, setFinalPlanData] = useState<FinalPlanData | null>(null);

  // State for fake progress bar
  const [planProgress, setPlanProgress] = useState<number>(0);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const [isAssistantThinking, setIsAssistantThinking] = useState(false);
  const [pendingAssistantMessage, setPendingAssistantMessage] = useState<string | null>(null);
  const [displayedAssistantMessage, setDisplayedAssistantMessage] = useState<string>("");
  const streamingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const [isApplyingPlan, setIsApplyingPlan] = useState(false);

  // State for success message
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [sheetConnector] = useState(() => new SheetConnector());
  const [chatService] = useState(() => new ChatService("https://bbaf-171-66-12-34.ngrok-free.app"));

  const handleSlotsReady = (filledSlots: any) => {
    console.log("Slots ready:", filledSlots);
    setSlots(filledSlots);

    // Add a contextual message before showing the plan trigger
    setMessages(prev => [...prev, {
       role: 'assistant', 
       message: 'Okay, I have all the parameters. Please select your relevant cap table data range in the sheet, including headers, then click \"Get Selected Range\".' 
    }]);

    setIsReady(true);
    // setPlanOps([]); // Already cleared elsewhere or maybe not needed
    setErrorMessage(null);
    setSelectedRangeAddress(null); // Ensure range is cleared initially
    setPlanTaskId(null);
    setFinalPlanData(null); // Clear any previous plan data
    if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
  };

  const handleChatError = (message: string) => {
    setErrorMessage(message);
    setIsLoading(false);
  };

  const clearProgressInterval = () => {
      if (progressIntervalRef.current) {
          clearInterval(progressIntervalRef.current);
          progressIntervalRef.current = null;
      }
      setPlanProgress(0); // Reset progress
  };

  const checkPlanStatus = async (taskId: string, formatting: RangeFormatting | null) => {
    if (!taskId || !formatting) {
      console.error("Polling started without formatting info, stopping.");
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
      setErrorMessage("Internal error: Formatting info lost during polling setup.");
      setIsLoading(false);
      setPlanTaskId(null);
      return;
    }
    console.log(`Checking status for task: ${taskId}`);
    try {
      const statusResponse = await chatService.getPlanResult(taskId);
      console.log("Poll response:", statusResponse);

      if (statusResponse.status === "completed") {
        console.log("Plan generation completed!");
        if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
        clearProgressInterval(); // Stop fake progress
        setPlanProgress(100); // SET progress to 100%

        setFinalPlanData({
          backendResult: statusResponse.result,
          formatting: formatting,
        });
        setPlanOps(statusResponse.result.ops || []);
        
        // Delay resetting isLoading slightly to allow 100% to show
        setTimeout(() => { 
           setIsLoading(false); 
           setPlanTaskId(null);
        }, 300); // Short delay (e.g., 300ms)
      } else if (statusResponse.status === "failed") {
        console.error("Plan generation failed:", statusResponse.error);
        if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
        setErrorMessage(`Plan generation failed: ${statusResponse.error || "Unknown error"}`);
        setIsLoading(false);
        setPlanTaskId(null);
        setCapturedFormatting(null);
        setFinalPlanData(null);
        clearProgressInterval(); // Stop progress on failure
      } else {
        console.log("Plan still processing...");
      }
    } catch (error: any) {
      console.error("Error during polling:", error);
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
      setErrorMessage(`Error checking plan status: ${error.message}`);
      setIsLoading(false);
      setPlanTaskId(null);
      setCapturedFormatting(null);
      setFinalPlanData(null);
      clearProgressInterval(); // Stop progress on error
    }
  };

  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
      clearProgressInterval(); // Also clear progress interval
    };
  }, []);

  const handleGeneratePlan = async () => {
    // --- First step: Get/Confirm selected range address ---
    let currentAddress = selectedRangeAddress;
    if (!currentAddress) {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        console.log("Attempting to get selected range address...");
        const address = await sheetConnector.getSelectedRangeAddress();
        setSelectedRangeAddress(address);
        console.log("Selected range address confirmed:", address);
        // Update local variable for use below if address was just fetched
        currentAddress = address;
      } catch (error: any) {
        console.error("Error getting selected range address:", error);
        setErrorMessage(error.message || "Failed to get selected range address.");
        setSelectedRangeAddress(null);
      } finally {
        setIsLoading(false);
      }
      return; // Return if we only fetched the address this time
    }

    // --- If address is confirmed, proceed to generate plan ---
    setIsLoading(true);
    setErrorMessage(null);
    setFinalPlanData(null); 
    setCapturedFormatting(null); 
    clearProgressInterval();
    setPlanProgress(5); 

    try {
      console.log(`Reading sheet data from confirmed range: ${currentAddress}...`);
      const sheetData = await sheetConnector.getRangeData(currentAddress);
      console.log("Sheet data read from confirmed range.");

      // No need to format here, backend expects raw data
      // const formattedSheetData = sheetData.map(row =>
      //   row.map(cell => cell === null || cell === undefined ? "" : String(cell))
      // );

      console.log("Requesting plan generation and capturing formatting...");
      // Call generatePlan WITH the sheetConnector instance
      const initialResponse = await chatService.generatePlan(
        slots,
        sheetData,
        currentAddress,
        sheetConnector
      );

      if (initialResponse && initialResponse.task_id && initialResponse.rangeFormatting) {
        console.log(`Plan generation started with Task ID: ${initialResponse.task_id}`);
        // Store the captured formatting in state
        setCapturedFormatting(initialResponse.rangeFormatting);
        setPlanTaskId(initialResponse.task_id);
        setIsLoading(true);
        // Clear previous interval if any
        if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);

        // --- Start Fake Progress Interval (Faster) ---
        const totalDurationSeconds = 20; // REDUCED target duration
        const intervalDelay = 500; 
        const increments = (totalDurationSeconds * 1000) / intervalDelay;
        const progressStep = 95 / increments; 

        progressIntervalRef.current = setInterval(() => {
          setPlanProgress(prev => {
             const nextProgress = prev + progressStep;
             return Math.min(nextProgress, 99); 
          });
        }, intervalDelay);
        // ------------------------------------------

        // Start polling interval (keep existing logic)
        pollingIntervalRef.current = setInterval(() => {
          checkPlanStatus(initialResponse.task_id, initialResponse.rangeFormatting);
        }, 10000); 
      } else {
        throw new Error("Failed to start plan generation task or capture formatting.");
      }
    } catch (error: any) {
      console.error("Error during plan generation setup:", error); // Clarified log
      setErrorMessage(error.message || "Failed to generate plan. Please check logs.");
      setIsLoading(false);
      setPlanTaskId(null);
      setCapturedFormatting(null); // Clear formatting on error too
      clearProgressInterval(); // Clear progress on setup error
    }
  };

  const handleApplyPlan = async (approvedOps: ActionOp[]) => {
    // We might not need approvedOps if we apply the whole result directly
    // Keep it for now in case PreviewPane filtering is still desired, but we'll use finalPlanData
    if (!finalPlanData) {
      setErrorMessage("Cannot apply plan: missing final plan data or formatting.");
      return;
    }
    // Maybe check approvedOps length if filtering is implemented in PreviewPane?
    // if (!approvedOps || approvedOps.length === 0) {
    //     setErrorMessage("No operations selected to apply.");
    //     return;
    // }

    setIsApplyingPlan(true);
    setErrorMessage(null);
    setSuccessMessage(null); // Clear previous success message
    try {
      console.log("Applying formatted plan with:", finalPlanData);
      
      await sheetConnector.applyFormattedPlan(
        finalPlanData.backendResult,
        finalPlanData.formatting
      );
      
      console.log("Formatted plan applied successfully.");
      
      // --- Show Success Notification --- 
      setSuccessMessage("Plan applied successfully!");
      setTimeout(() => {
          setSuccessMessage(null);
          // Reset UI state AFTER success message fades
          setPlanOps([]); 
          setFinalPlanData(null);
          setCapturedFormatting(null);
          setIsReady(false); 
          setSelectedRangeAddress(null);
          setSlots({ roundType: undefined, amount: undefined, preMoney: undefined, poolPct: undefined});
      }, 2500); // Show message for 2.5 seconds
      // ----------------------------------

      // Don't reset state immediately, wait for timeout above
      // setPlanOps([]); 
      // setFinalPlanData(null);
      // ...
      
    } catch (error: any) {
      console.error('Error applying formatted plan:', error);
      setErrorMessage(error.message || 'Failed to apply formatted plan. Check console.');
    } finally {
      // Set applying to false immediately, but delay other state resets
      setIsApplyingPlan(false);
    }
  };

  const handleSendMessage = async (userMessage: string) => {
    if (!userMessage.trim()) return;

    // Add user message to history immediately
    setMessages(prev => [...prev, { role: 'user', message: userMessage }]);
    setErrorMessage(null);
    setIsLoading(true); // General loading state
    setIsAssistantThinking(true); // Specific state for chat response
    setPendingAssistantMessage(null); // Clear any pending message
    setDisplayedAssistantMessage(""); // Clear displayed message

    try {
      const response: ChatResponse = await chatService.sendMessage(userMessage);
      
      setIsAssistantThinking(false); // Assistant is no longer thinking
      setIsLoading(false); // Turn off general loading

      if (response.assistantMessage) {
         // Instead of adding directly, set it as pending for streaming
         setPendingAssistantMessage(response.assistantMessage);
      }

      if (response.slotsFilled) {
        setSlots(response.slotsFilled);
      }

      if (response.ready) {
        handleSlotsReady(response.slotsFilled);
      }

    } catch (error: any) {
      console.error("Error sending/receiving chat message:", error);
      setErrorMessage(error.message || "Failed to get response from assistant.");
      setIsAssistantThinking(false);
      setIsLoading(false);
    }
  };

  // Effect for simulating streaming text
  useEffect(() => {
    if (streamingIntervalRef.current) {
      clearInterval(streamingIntervalRef.current);
      streamingIntervalRef.current = null;
    }

    if (pendingAssistantMessage) {
      setDisplayedAssistantMessage(""); // Start fresh
      let index = 0;
      const message = pendingAssistantMessage; // Capture current pending message

      streamingIntervalRef.current = setInterval(() => {
        if (index < message.length) {
          // Append character by character (adjust speed with interval delay)
          setDisplayedAssistantMessage(prev => message.substring(0, index + 1));
          index++;
        } else {
          // Finished streaming
          if (streamingIntervalRef.current) clearInterval(streamingIntervalRef.current);
          streamingIntervalRef.current = null;
          
          // Add the completed message to the main history (NO flag needed)
          setMessages(prev => [...prev, { role: 'assistant', message }]);
          
          // Clear pending/displayed state
          setPendingAssistantMessage(null); 
          setDisplayedAssistantMessage(""); 
        }
      }, 50); 
    }

    // Cleanup function to clear interval if component unmounts or pending message changes
    return () => {
      if (streamingIntervalRef.current) {
        clearInterval(streamingIntervalRef.current);
        streamingIntervalRef.current = null;
      }
    };
  }, [pendingAssistantMessage]); // Re-run effect when pendingAssistantMessage changes

  return (
    // Use ms-Fabric for some basic Office styling, add padding
    <div className="app" dir="ltr" style={appStyles.container}>
      {/* <SlotStatusBar slots={slots} /> */}
      {/* Remove rendering */}

      {/* Add flex-grow to ChatView/PreviewPane containers */}
      <div
        id="react-container"
        className="flex flex-col justify-center"
        style={appStyles.mainContent}
      >
        {/* Restore conditional rendering */}
        {!isReady && !finalPlanData && (
          <ChatView
            messages={messages}
            onSendMessage={handleSendMessage}
            isThinking={isAssistantThinking}
            streamingMessage={displayedAssistantMessage}
            onError={handleChatError}
            isLoading={isLoading}
          />
        )}

        {isReady && !finalPlanData && (
            <div style={appStyles.planTriggerContainer}>
                <h4>Parameters Collected:</h4>
                <p style={appStyles.instructionText}>
                  {selectedRangeAddress 
                    ? `Selected Range: ${selectedRangeAddress}` 
                    : "Please select the relevant data range in your sheet."} 
                </p>
                {selectedRangeAddress && (
                  <button 
                    style={{marginRight: '10px'}} // Keep inline margin
                    // Add dynamic className for loading state
                    className={`rounded-lg px-4 py-2 cursor-pointer ${ // Added padding
                      isLoading
                        ? "bg-gray-700 text-gray-400 cursor-not-allowed" // Loading style
                        : "bg-gray-200 text-black hover:bg-gray-300" // Secondary button style (non-loading)
                    }`}
                    onClick={() => setSelectedRangeAddress(null)} 
                    disabled={isLoading}
                  >
                    Change Selection
                  </button>
                )}
                <button 
                  // RESTORE original inline style logic
                  style={isLoading ? {...appStyles.button, ...appStyles.buttonDisabled} : appStyles.button}
                  // Keep className for basic structure (padding, rounded corners)
                  className={`rounded-lg px-4 py-2 cursor-pointer ${ // Use non-conditional part of class if needed, or remove if style handles everything
                    isLoading
                      ? "cursor-not-allowed" // Only add cursor style if needed
                      : "hover:bg-gray-800" // Add hover effect if style doesn't provide one
                  }`}
                  onClick={handleGeneratePlan} 
                  disabled={isLoading}
                >
                  {isLoading 
                    ? (planTaskId ? 'Generating Plan (takes ~1min)...': 'Getting Selection...') 
                    : (selectedRangeAddress ? 'Confirm and Generate Plan' : 'Get Selected Range')}
                </button>
            </div>
        )}

        {/* Show PreviewPane if final plan data IS available */}
        {finalPlanData && (
          <PreviewPane
            ops={finalPlanData.backendResult.ops} // Pass ops from finalPlanData
            onApply={handleApplyPlan}
            isLoading={isLoading || isApplyingPlan}
            isApplying={isApplyingPlan}
          />
        )}
      </div>

      {/* Footer for messages */}
      <div style={appStyles.footer}>
        {/* Show Success Message */}
        {successMessage && (
           <div style={appStyles.successMessage}>{successMessage}</div>
        )}
        {/* Show Error Message (only if no success message) */}
        {errorMessage && !successMessage && (
            <div style={appStyles.errorMessage}>Error: {errorMessage}</div>
        )}
        {/* Show Progress Bar (only if no success/error) */}
        {isLoading && planTaskId && !finalPlanData && !errorMessage && !successMessage && (
           // Render Progress Bar when plan is generating
           <div style={appStyles.progressBarContainer}>
             <div 
               style={{...appStyles.progressBarFill, width: `${planProgress}%`}} 
             />
             <span style={appStyles.progressBarText}>
               Generating plan... ({Math.round(planProgress)}%)
             </span>
           </div>
        )}
      </div>
    </div>
  );
}

// Basic inline styles (consider moving to CSS Modules or a styled-components approach later)
const appStyles: { [key: string]: React.CSSProperties } = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    padding: "15px",
    boxSizing: "border-box",
    fontFamily: '"Segoe UI", system-ui, sans-serif', // Use Office Fabric font
    // backgroundColor: 'lightblue' // DEBUG: Remove Container background
  },
  mainContent: {
    flexGrow: 1,
    display: "flex",
    flexDirection: "column",
    overflowY: "auto", // Allow content to scroll if needed
    marginBottom: "10px",
    // backgroundColor: 'lightcoral' // DEBUG: Remove Main content background
  },
  planTriggerContainer: {
    padding: "15px",
    border: "1px solid #eee",
    borderRadius: "4px",
    backgroundColor: "#f9f9f9",
    marginTop: "10px",
  },
  instructionText: {
    fontSize: "0.9em",
    color: "#555",
    marginBottom: "10px",
  },
  parameterList: {
    listStyle: "none",
    paddingLeft: "0",
    fontSize: "0.9em",
  },
  button: {
    padding: "8px 16px",
    backgroundColor: "#000", // Office blue
    color: "white",
    border: "none",
    borderRadius: "2px",
    cursor: "pointer",
    fontSize: "1em",
  },
  secondaryButton: {
    backgroundColor: "#f0f0f0",
    color: "#000",
    border: "1px solid #ccc",
  },
  buttonDisabled: {
    backgroundColor: "#c7e0f4", // Lighter blue
    cursor: "not-allowed",
  },
  footer: {
    minHeight: '60px', 
    marginTop: 'auto', 
    paddingTop: '10px', 
    position: 'relative' // Needed for positioning success message maybe
  },
  errorMessage: {
      color: '#a80000',
      marginTop: '10px',
      padding: '10px',
      border: '1px solid #fde7e9',
      backgroundColor: '#fde7e9', 
      borderRadius: '2px'
  },
  successMessage: { // Style for success notification
      color: '#155724', // Dark green
      backgroundColor: '#d4edda', // Light green
      border: '1px solid #c3e6cb',
      padding: '10px',
      borderRadius: '4px',
      textAlign: 'center',
      marginTop: '10px',
      // Optional: Add fade-out animation later
  },
  progressBarContainer: {
      height: '20px',
      backgroundColor: '#e0e0e0', // Light grey background
      borderRadius: '10px',
      overflow: 'hidden',
      position: 'relative', // Needed for text overlay
      marginTop: '10px'
  },
  progressBarFill: {
      height: '100%',
      backgroundColor: '#0078d4', // Office blue
      borderRadius: '10px 0 0 10px', // Keep left edge rounded
      transition: 'width 0.4s ease-in-out' // Smooth transition for width change
  },
  progressBarText: {
      position: 'absolute',
      width: '100%',
      textAlign: 'center',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      color: '#fff', // White text
      mixBlendMode: 'difference', // Makes text visible on blue/grey bg
      fontSize: '0.8em',
      lineHeight: '20px'
  }
};

import React, { useState, useEffect, useRef } from "react";
import { ChatView } from "./components/ChatView";
import { PreviewPane } from "./components/PreviewPane";
import { SheetConnector, ActionOp, RangeFormatting } from "./SheetConnector";
import { ChatService } from "./services/chatService";

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
  const [planOps, setPlanOps] = useState<ActionOp[]>([]);
  const [selectedRangeAddress, setSelectedRangeAddress] = useState<string | null>(null);
  const [planTaskId, setPlanTaskId] = useState<string | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  // NEW State for captured formatting
  const [capturedFormatting, setCapturedFormatting] = useState<RangeFormatting | null>(null);
  // NEW State for combined final data
  const [finalPlanData, setFinalPlanData] = useState<FinalPlanData | null>(null);
  

  const [sheetConnector] = useState(() => new SheetConnector());
  const [chatService] = useState(() => new ChatService("https://bbaf-171-66-12-34.ngrok-free.app"));

  const handleSlotsReady = (filledSlots: any) => {
    console.log("Slots ready:", filledSlots);
    setSlots(filledSlots);
    setIsReady(true);
    setPlanOps([]);
    setErrorMessage(null);
    setSelectedRangeAddress(null);
    setPlanTaskId(null);
    if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
  };

  const handleChatError = (message: string) => {
    setErrorMessage(message);
    setIsLoading(false);
  };

  const checkPlanStatus = async (taskId: string, formatting: RangeFormatting | null) => {
    if (!taskId || !formatting) {
        console.error("Polling started without formatting info, stopping.");
        if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
        setErrorMessage("Internal error: Formatting info lost during polling setup.")
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

        setFinalPlanData({
          backendResult: statusResponse.result,
          formatting: formatting
        });
        setPlanOps(statusResponse.result.ops || []);
        
        setIsLoading(false);
        setPlanTaskId(null);

      } else if (statusResponse.status === "failed") {
        console.error("Plan generation failed:", statusResponse.error);
        if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
        setErrorMessage(`Plan generation failed: ${statusResponse.error || "Unknown error"}`);
        setIsLoading(false);
        setPlanTaskId(null);
        setCapturedFormatting(null);
        setFinalPlanData(null);
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
    }
  };

  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
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
    // setPlanOps([]); // Clear previous ops
    setFinalPlanData(null); // Clear previous final data
    setCapturedFormatting(null); // Clear previous formatting

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
      const initialResponse = await chatService.generatePlan(slots, sheetData, currentAddress, sheetConnector);
      
      // Store formatting and start polling
      if (initialResponse && initialResponse.task_id && initialResponse.rangeFormatting) {
        console.log(`Plan generation started with Task ID: ${initialResponse.task_id}`);
        // Store the captured formatting in state
        setCapturedFormatting(initialResponse.rangeFormatting);
        setPlanTaskId(initialResponse.task_id);
        setIsLoading(true);
        // Clear previous interval if any
        if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
        // Start new polling interval
        pollingIntervalRef.current = setInterval(() => {
          // Pass the task ID AND the captured formatting to checkPlanStatus
          checkPlanStatus(initialResponse.task_id, initialResponse.rangeFormatting);
        }, 10000); // Poll every 10 seconds
      } else {
        throw new Error("Failed to start plan generation task or capture formatting.");
      }
    } catch (error: any) {
      console.error('Error during plan generation setup:', error); // Clarified log
      setErrorMessage(error.message || 'Failed to generate plan. Please check logs.');
      setIsLoading(false);
      setPlanTaskId(null);
      setCapturedFormatting(null); // Clear formatting on error too
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

    setIsLoading(true);
    setErrorMessage(null);
    try {
      // console.log("Applying operations:", approvedOps); // Log the whole plan data instead?
      console.log("Applying formatted plan with:", finalPlanData);
      
      // Call the NEW function with the combined data
      await sheetConnector.applyFormattedPlan(finalPlanData.backendResult, finalPlanData.formatting);
      
      console.log("Formatted plan applied successfully.");
      
      // Clear state after successful application
      setPlanOps([]); // Clear ops used by PreviewPane
      setFinalPlanData(null);
      setCapturedFormatting(null); // Though already null if finalPlanData was set
      setIsReady(false); // Go back to chat view? Or show a success message?
      setSelectedRangeAddress(null); // Clear selected address
      setSlots({ roundType: undefined, amount: undefined, preMoney: undefined, poolPct: undefined}); // Reset slots
      
    } catch (error: any) {
      console.error('Error applying formatted plan:', error);
      setErrorMessage(error.message || 'Failed to apply formatted plan. Check console.');
      // Consider leaving finalPlanData intact on error for potential retry?
      // setFinalPlanData(null);
      // setCapturedFormatting(null);

    } finally {
      setIsLoading(false);
    }
  };

  return (
    // Use ms-Fabric for some basic Office styling, add padding
    <div className="app ms-Fabric" dir="ltr" style={appStyles.container}>
      {/* <SlotStatusBar slots={slots} /> */}{/* Remove rendering */}
      
      {/* Add flex-grow to ChatView/PreviewPane containers */} 
      <div style={appStyles.mainContent}>
        {/* Show ChatView if not ready AND no final plan data exists */} 
        {!isReady && !finalPlanData && (
            <ChatView 
                chatService={chatService} 
                onReady={handleSlotsReady} 
                onError={handleChatError} 
                isLoading={isLoading}
            />
        )}

        {/* Show Plan Trigger if ready AND no final plan data exists */} 
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
                    ? (planTaskId ? 'Generating Plan (takes ~4min)...': 'Getting Selection...') 
                    : (selectedRangeAddress ? 'Confirm and Generate Plan' : 'Get Selected Range')}
                </button>
            </div>
        )}

        {/* Show PreviewPane if final plan data IS available */} 
        {finalPlanData && (
            <PreviewPane 
                ops={finalPlanData.backendResult.ops} // Pass ops from finalPlanData
                onApply={handleApplyPlan}
                isLoading={isLoading}
            />
        )}
      </div>

      {/* Footer for messages */}
      <div style={appStyles.footer}>
        {errorMessage && <div style={appStyles.errorMessage}>Error: {errorMessage}</div>}

        {isLoading && (
          <div style={appStyles.loadingIndicator}>
            {planTaskId ? "Generating plan... (this may take up to 5 minutes)" : "Processing..."}
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
    minHeight: "40px", // Ensure footer has some height even when empty
    marginTop: "auto", // Push footer to bottom
    // backgroundColor: 'lightgoldenrodyellow' // DEBUG: Remove Footer background
  },
  errorMessage: {
    color: "#a80000", // Office error red
    marginTop: "10px",
    padding: "10px",
    border: "1px solid #fde7e9",
    backgroundColor: "#fde7e9", // Light red background
    borderRadius: "2px",
  },
  loadingIndicator: {
    marginTop: "10px",
    padding: "10px",
    fontStyle: "italic",
    color: "#555",
  },
};

import React, { useState, useEffect, useRef } from "react";
import { ChatView, ChatMessage } from "./components/ChatView";
import { PreviewPane } from "./components/PreviewPane";
import { SheetConnector, ActionOp, RangeFormatting, BackendPlanResult } from "./SheetConnector";
import { ChatService, ChatResponse } from "./services/chatService";

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
  const [isRejectingPreview, setIsRejectingPreview] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isPreviewActive, setIsPreviewActive] = useState<boolean>(false);

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
    setIsPreviewActive(false);
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

  const showPreview = async (backendResult: BackendPlanResult, formatting: RangeFormatting) => {
    setIsPreviewing(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    console.log("Attempting to apply preview...");
    try {
      await sheetConnector.applyPreview(backendResult.ops);
      console.log("Preview applied to sheet successfully.");
      
      setFinalPlanData({ backendResult, formatting });
      setIsPreviewActive(true);
      setPlanOps(backendResult.ops);

    } catch (error: any) {
      console.error("Error applying preview:", error);
      setErrorMessage(`Failed to apply preview: ${error.message}`);
      setFinalPlanData(null);
      setIsPreviewActive(false);
      setPlanOps([]);
    } finally {
      setIsPreviewing(false);
      setIsLoading(false);
    }
  };

  const checkPlanStatus = async (taskId: string, formatting: RangeFormatting | null) => {
    if (!taskId || !formatting) {
      console.error("Polling started without formatting info, stopping.");
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
      setErrorMessage("Internal error: Formatting info lost during polling setup.");
      setIsLoading(false);
      setPlanTaskId(null);
      setIsPreviewActive(false);
      return;
    }
    console.log(`Checking status for task: ${taskId}`);
    try {
      const statusResponse = await chatService.getPlanResult(taskId);
      console.log("Poll response:", statusResponse);

      if (statusResponse.status === "completed") {
        console.log("Plan generation completed! Initiating preview...");
        if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
        clearProgressInterval();
        setPlanProgress(100);

        await showPreview(statusResponse.result, formatting);
        setPlanTaskId(null);
      } else if (statusResponse.status === "failed") {
        console.error("Plan generation failed:", statusResponse.error);
        if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
        setErrorMessage(`Plan generation failed: ${statusResponse.error || "Unknown error"}`);
        setIsLoading(false);
        setPlanTaskId(null);
        setCapturedFormatting(null);
        setFinalPlanData(null);
        setIsPreviewActive(false);
        clearProgressInterval();
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
      setIsPreviewActive(false);
      clearProgressInterval();
    }
  };

  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
      clearProgressInterval();
    };
  }, []);

  const handleGeneratePlan = async () => {
    let currentAddress = selectedRangeAddress;
    if (!currentAddress) {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        console.log("Attempting to get selected range address...");
        const address = await sheetConnector.getSelectedRangeAddress();
        setSelectedRangeAddress(address);
        console.log("Selected range address confirmed:", address);
        currentAddress = address;
      } catch (error: any) {
        console.error("Error getting selected range address:", error);
        setErrorMessage(error.message || "Failed to get selected range address.");
        setSelectedRangeAddress(null);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setFinalPlanData(null);
    setIsPreviewActive(false);
    setCapturedFormatting(null);
    clearProgressInterval();
    setPlanProgress(5);

    try {
      console.log("*** Entered handleGeneratePlan try block ***");

      console.log(`Attempting to read sheet data from confirmed range: ${currentAddress}...`);
      console.log("Calling sheetConnector.getRangeData...");
      const sheetData = await sheetConnector.getRangeData(currentAddress);
      console.log("sheetConnector.getRangeData finished successfully.");
      console.log("Sheet data read from confirmed range.");

      console.log("*** Sending to /plan endpoint ***");
      console.log("Slots:", JSON.stringify(slots, null, 2));
      console.log("Sheet Data Snippet:", JSON.stringify(sheetData.slice(0, 5), null, 2));
      console.log("Range Address:", currentAddress);

      console.log("Requesting plan generation and capturing formatting...");
      const initialResponse = await chatService.generatePlan(
        slots,
        sheetData,
        currentAddress,
        sheetConnector
      );

      if (initialResponse && initialResponse.task_id && initialResponse.rangeFormatting) {
        console.log(`Plan generation started with Task ID: ${initialResponse.task_id}`);
        setCapturedFormatting(initialResponse.rangeFormatting);
        setPlanTaskId(initialResponse.task_id);
        setIsLoading(true);
        if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);

        const totalDurationSeconds = 20;
        const intervalDelay = 500;
        const increments = (totalDurationSeconds * 1000) / intervalDelay;
        const progressStep = 95 / increments;

        progressIntervalRef.current = setInterval(() => {
          setPlanProgress(prev => {
             const nextProgress = prev + progressStep;
             return Math.min(nextProgress, 99); 
          });
        }, intervalDelay);

        pollingIntervalRef.current = setInterval(() => {
          checkPlanStatus(initialResponse.task_id, initialResponse.rangeFormatting);
        }, 10000);
      } else {
        throw new Error("Failed to start plan generation task or capture formatting.");
      }
    } catch (error: any) {
      console.error("Error during plan generation setup:", error);
      setErrorMessage(error.message || "Failed to generate plan. Please check logs.");
      setIsLoading(false);
      setPlanTaskId(null);
      setCapturedFormatting(null);
      setIsPreviewActive(false);
      clearProgressInterval();
    }
  };

  const handleAcceptPreview = async () => {
    if (!finalPlanData) {
      setErrorMessage("Cannot accept plan: missing final plan data or formatting.");
      return;
    }
    setIsApplyingPlan(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    console.log("Attempting to accept preview by applying final plan...");
    try {
      await sheetConnector.acceptPreview(
        finalPlanData.backendResult,
        finalPlanData.formatting
      );
      
      console.log("Preview accepted and final plan applied.");
      
      setSuccessMessage("Plan applied successfully!");
      setTimeout(() => {
          setSuccessMessage(null);
          setPlanOps([]);
          setFinalPlanData(null);
          setCapturedFormatting(null);
          setIsPreviewActive(false);
          setIsReady(false);
          setSelectedRangeAddress(null);
          setSlots({ roundType: undefined, amount: undefined, preMoney: undefined, poolPct: undefined});
      }, 2500);
      
    } catch (error: any) {
      console.error('Error accepting preview:', error);
      setErrorMessage(error.message || 'Failed to accept preview. Check console.');
    } finally {
      setIsApplyingPlan(false);
    }
  };

  const handleRejectPreview = async () => {
    setIsRejectingPreview(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    console.log("Attempting to reject preview...");
    try {
      await sheetConnector.rejectPreview();
      console.log("Preview rejected and changes reverted.");
      
      setMessages(prev => [...prev, { role: 'assistant', message: 'Preview rejected. You can modify parameters or selection and try again.' }]);
      
      setFinalPlanData(null);
      setPlanOps([]);
      setIsPreviewActive(false);
      setCapturedFormatting(null);
      setSelectedRangeAddress(null);
      setIsReady(true);
      
    } catch (error: any) {
      console.error("Error rejecting preview:", error);
      setErrorMessage(`Failed to reject preview: ${error.message}. Manual cleanup might be needed.`);
      setFinalPlanData(null);
      setPlanOps([]);
      setIsPreviewActive(false);
    } finally {
      setIsRejectingPreview(false);
    }
  };

  const handleSendMessage = async (userMessage: string) => {
    if (!userMessage.trim()) return;

    setMessages(prev => [...prev, { role: 'user', message: userMessage }]);
    setErrorMessage(null);
    setIsLoading(true);
    setIsAssistantThinking(true);
    setPendingAssistantMessage(null);
    setDisplayedAssistantMessage("");

    try {
      const response: ChatResponse = await chatService.sendMessage(userMessage);
      
      setIsAssistantThinking(false);
      setIsLoading(false);

      if (response.assistantMessage) {
         setPendingAssistantMessage(response.assistantMessage);
      }

      if (response.slotsFilled) {
        setSlots(response.slotsFilled);
      }

      if (response.ready) {
        setFinalPlanData(null);
        setIsPreviewActive(false);
        setPlanOps([]);
        handleSlotsReady(response.slotsFilled);
      }

    } catch (error: any) {
      console.error("Error sending/receiving chat message:", error);
      setErrorMessage(error.message || "Failed to get response from assistant.");
      setIsAssistantThinking(false);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (streamingIntervalRef.current) {
      clearInterval(streamingIntervalRef.current);
      streamingIntervalRef.current = null;
    }

    if (pendingAssistantMessage) {
      setDisplayedAssistantMessage("");
      let index = 0;
      const message = pendingAssistantMessage;

      streamingIntervalRef.current = setInterval(() => {
        if (index < message.length) {
          setDisplayedAssistantMessage(prev => message.substring(0, index + 1));
          index++;
        } else {
          if (streamingIntervalRef.current) clearInterval(streamingIntervalRef.current);
          streamingIntervalRef.current = null;
          
          setMessages(prev => [...prev, { role: 'assistant', message }]);
          
          setPendingAssistantMessage(null); 
          setDisplayedAssistantMessage(""); 
        }
      }, 50); 
    }

    return () => {
      if (streamingIntervalRef.current) {
        clearInterval(streamingIntervalRef.current);
        streamingIntervalRef.current = null;
      }
    };
  }, [pendingAssistantMessage]);

  const isPreviewPaneBusy = isLoading || isApplyingPlan || isPreviewing || isRejectingPreview;

  return (
    <div className="app" dir="ltr" style={appStyles.container}>
      <div
        id="react-container"
        className="flex flex-col justify-center"
        style={appStyles.mainContent}
      >
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
                    style={{marginRight: '10px'}}
                    className={`rounded-lg px-4 py-2 cursor-pointer ${
                      isLoading
                        ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                        : "bg-gray-200 text-black hover:bg-gray-300"
                    }`}
                    onClick={() => setSelectedRangeAddress(null)} 
                    disabled={isLoading}
                  >
                    Change Selection
                  </button>
                )}
                <button 
                  style={isLoading ? {...appStyles.button, ...appStyles.buttonDisabled} : appStyles.button}
                  className={`rounded-lg px-4 py-2 cursor-pointer ${
                    isLoading
                      ? "cursor-not-allowed"
                      : "hover:bg-gray-800"
                  }`}
                  onClick={handleGeneratePlan} 
                  disabled={isLoading}
                >
                  {isLoading 
                    ? (planTaskId ? 'Generating Plan (takes ~1min)...': (isPreviewing ? 'Applying Preview...': 'Getting Selection...'))
                    : (selectedRangeAddress ? 'Confirm and Generate Plan' : 'Get Selected Range')}
                </button>
            </div>
        )}

        {finalPlanData && (
          <PreviewPane
            ops={finalPlanData.backendResult.ops}
            onAccept={handleAcceptPreview}
            onReject={handleRejectPreview}
            isLoading={isPreviewPaneBusy}
            isApplying={isApplyingPlan}
          />
        )}
      </div>

      <div style={appStyles.footer}>
        {successMessage && (
           <div style={appStyles.successMessage}>{successMessage}</div>
        )}
        {errorMessage && !successMessage && (
            <div style={appStyles.errorMessage}>Error: {errorMessage}</div>
        )}
        {isLoading && planTaskId && !errorMessage && !successMessage && (
           <div style={appStyles.progressBarContainer}>
             <div 
               style={{...appStyles.progressBarFill, width: `${planProgress}%`}}
             />
             <span style={appStyles.progressBarText}>
               {`Generating plan... (${Math.round(planProgress)}%)`}
             </span>
           </div>
        )}
      </div>
    </div>
  );
}

const appStyles: { [key: string]: React.CSSProperties } = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    padding: "15px",
    boxSizing: "border-box",
    fontFamily: '"Segoe UI", system-ui, sans-serif',
  },
  mainContent: {
    flexGrow: 1,
    display: "flex",
    flexDirection: "column",
    overflowY: "auto",
    marginBottom: "10px",
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
    backgroundColor: "#000",
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
    backgroundColor: "#c7e0f4",
    cursor: "not-allowed",
  },
  footer: {
    minHeight: '60px', 
    marginTop: 'auto', 
    paddingTop: '10px', 
    position: 'relative'
  },
  errorMessage: {
      color: '#a80000',
      marginTop: '10px',
      padding: '10px',
      border: '1px solid #fde7e9',
      backgroundColor: '#fde7e9', 
      borderRadius: '2px'
  },
  successMessage: {
      color: '#155724',
      backgroundColor: '#d4edda',
      border: '1px solid #c3e6cb',
      padding: '10px',
      borderRadius: '4px',
      textAlign: 'center',
      marginTop: '10px',
  },
  progressBarContainer: {
      height: '20px',
      backgroundColor: '#e0e0e0',
      borderRadius: '10px',
      overflow: 'hidden',
      position: 'relative',
      marginTop: '10px'
  },
  progressBarFill: {
      height: '100%',
      backgroundColor: '#0078d4',
      borderRadius: '10px 0 0 10px',
      transition: 'width 0.4s ease-in-out'
  },
  progressBarText: {
      position: 'absolute',
      width: '100%',
      textAlign: 'center',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      color: '#fff',
      mixBlendMode: 'difference',
      fontSize: '0.8em',
      lineHeight: '20px'
  }
};

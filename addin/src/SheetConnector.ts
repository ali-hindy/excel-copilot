/* global Excel, console, OfficeExtension */

// Define the structure for an operation, matching the server's expectation
export interface ActionOp {
  id: string;
  range: string; // Excel A1 notation (e.g., "A1", "B2:C5")
  type: "write" | "formula"; // Removed "color" type, will handle via formatting logic
  values?: any[][]; // Changed to 2D array for consistency with Excel.Range.values
  formula?: string; // Used for type: "formula"
  // color?: string; // Removed, handle via formatting
  note?: string;
}

// --- NEW: Interface for captured cell formatting ---
export interface CellStyle {
  font?: {
    bold?: boolean;
    italic?: boolean;
    color?: string | null; // Store hex color like "#RRGGBB" or null
    name?: string;
    size?: number;
    underline?: Excel.RangeUnderlineStyle | string;
  };
  fill?: {
    color?: string | null; // Store hex color like "#RRGGBB" or null
  };
  numberFormat?: string; // e.g., "General", "$#,##0.00", "0.00%"
  horizontalAlignment?: Excel.HorizontalAlignment | string; // e.g., "Left", "Center", "Right"
  verticalAlignment?: Excel.VerticalAlignment | string; // e.g., "Top", "Center", "Bottom"
  wrapText?: boolean;
  borders?: any;
}

// --- NEW: Structure to hold formatting for a range ---
// We might capture header row style separately from data row style
export interface RangeFormatting {
  address: string; // The address the formatting was read from
  rowCount: number;
  columnCount: number;
  headerRowStyle?: CellStyle[]; // Array length = columnCount, style for row 0
  dataRowStyle?: CellStyle[]; // Array length = columnCount, style for row 1 (or representative data row)
  // Could expand to capture style per cell, but column-based is simpler start
}

// Import BackendPlanResult if defined elsewhere, or define inline
export interface BackendPlanResult {
  ops: ActionOp[]; // Added ops based on App.tsx usage
  slots: any;
  calculated_values: any;
  column_mapping: any;
  // Add other fields if the backend sends more
}

// --- NEW: Interface for storing original cell state before preview ---
interface OriginalCellState {
  values: any[][];
  formatting: CellStyle[][]; // Store formatting cell-by-cell
}

export class SheetConnector {
  /**
   * Reads the entire used range of the active worksheet.
   * @returns A promise that resolves with a 2D array of strings (sheet data).
   */
  async readSheet(): Promise<string[][]> {
    // console.log("Attempting to read fixed range A1:C3 for testing..."); // Remove misleading log
    try {
      return await Excel.run(async (context) => {
        const sheet = context.workbook.worksheets.getActiveWorksheet();

        // --- Restore reading the used range ---
        console.log("Getting used range...");
        const range = sheet.getUsedRange();
        // const testRange = "A1:C3";
        // console.log(`Getting fixed range: ${testRange}`);
        // const range = sheet.getRange(testRange);
        // ----------------------------------------------------------

        // Try loading values with specific error handling
        try {
          console.log("Loading values for the range...");
          range.load("values");
          console.log("Calling context.sync()...");
          await context.sync();
          console.log("context.sync() completed. Returning values:", range.values);
          // Convert all values to strings
          return range.values.map(row =>
            row.map(cell => cell === null || cell === undefined ? "" : String(cell))
          );
        } catch (loadError) {
          console.error("--- Error details during range.load/sync in readSheet --- ");
          console.error("Original Error Object:", loadError); // Log the full object
          if (loadError instanceof OfficeExtension.Error) {
            console.error(`OfficeExtension Error Code: ${loadError.code}`);
            console.error(`OfficeExtension Error Message: ${loadError.message}`);
            console.error(`OfficeExtension Error Debug Info: ${JSON.stringify(loadError.debugInfo)}`);
          }
          // Rethrow the original error object to preserve details
          throw loadError;
        }
      });
    } catch (error) {
      // Handle potential errors like a blank sheet from getUsedRange (less likely now)
      // if (error instanceof OfficeExtension.Error && error.code === 'ItemNotFound') { ... }

      // Catch other errors (including the rethrown loadError)
      console.error("--- Error caught in outer catch block of readSheet --- ");
      console.error("Error Object:", error);
      throw error; // Re-throw to be caught by the caller (run function)
    }
  }

  /**
   * Reads the currently selected range in the active worksheet.
   * @returns A promise that resolves with a 2D array of strings (selected range data).
   * @throws An error if no range is selected.
   */
  async getSelectedRangeData(): Promise<string[][]> {
    console.log("Attempting to read selected range values..."); // Clarified log
    try {
      return await Excel.run(async (context) => {
        const range = context.workbook.getSelectedRange();
        // --- Load only values ---
        range.load("values");
        // -----------------------
        await context.sync();
        console.log("Selected range values loaded:", range.values);
        // Convert all values to strings
        return range.values.map((row) => row.map((cell) => (cell === null || cell === undefined ? "" : String(cell))));
      });
    } catch (error) {
      console.error("--- Error reading selected range --- ", error);
      if (error instanceof OfficeExtension.Error && error.code === "ItemNotFound") {
          // A more specific error can be thrown if needed,
          // e.g., throw new Error("Please select a range in the worksheet first.");
          // For now, rethrow the original to be handled by the caller
          throw new Error("No range selected. Please select cells in the sheet.");
      } else if (error instanceof Error && error.message === "No range selected. Please select cells in the sheet.") {
          // Rethrow our specific error
          throw error;
      } else {
          // Handle other potential errors
          console.error("Unexpected error reading selected range:", error);
          throw new Error("An unexpected error occurred while reading the selected range.");
      }
    }
  }

  /**
   * Reads detailed formatting from the currently selected range.
   * Captures style from the header row (row 0) and the first data row (row 1).
   * @returns A promise that resolves with a RangeFormatting object.
   * @throws An error if no range is selected or the range is too small.
   */
  async getSelectedRangeFormatting(): Promise<RangeFormatting> {
    console.log("Attempting to read selected range formatting...");
    try {
      return await Excel.run(async (context) => {
        const range = context.workbook.getSelectedRange();

        // Define the specific format properties we want to load
        // Loading the entire 'format' object can be inefficient/problematic
        range.load([
          "address",
          "rowCount",
          "columnCount",
          "format/font/bold",
          "format/font/italic",
          "format/font/color",
          "format/fill/color",
          "format/numberFormat",
          "format/horizontalAlignment",
          "format/verticalAlignment",
          "format/wrapText",
          "format/borders",
          // Add more properties here if needed, e.g., "format/borders/..."
        ]);

        await context.sync();

        console.log(`Selected range formatting loaded for ${range.address}`);
        console.log(`Dimensions: ${range.rowCount} rows, ${range.columnCount} columns`);


        if (range.rowCount < 1 || range.columnCount < 1) {
          throw new Error("Selected range is empty.");
        }

        const output: RangeFormatting = {
          address: range.address,
          rowCount: range.rowCount,
          columnCount: range.columnCount,
          headerRowStyle: [],
          dataRowStyle: [],
        };

        // --- Capture Header Row (Row 0) Style ---
        const headerRowRange = range.getRow(0);
        headerRowRange.load([ // Load specific properties for the row
            "format/font/bold",
            "format/font/italic",
            "format/font/color",
            "format/fill/color",
            "format/horizontalAlignment",
            "format/verticalAlignment",
            "format/wrapText",
            "format/borders",
            "numberFormat" // Load numberFormat directly
        ]);
        await context.sync(); // Sync after loading the specific row format

        for (let j = 0; j < range.columnCount; j++) {
          const cell = headerRowRange.getCell(0, j); // Get cell within the header row
          cell.load([ // Load specific properties for the cell
              "format/font/bold",
              "format/font/italic",
              "format/font/color",
              "format/font/name",
              "format/font/size",
              "format/font/underline",
              "format/fill/color",
              "format/horizontalAlignment",
              "format/verticalAlignment",
              "format/wrapText",
              "format/borders",
              "numberFormat",
              "note"
           ]);
           await context.sync(); // Sync per cell

          const style: CellStyle = {
            font: {
              bold: cell.format.font.bold,
              italic: cell.format.font.italic,
              color: cell.format.font.color || null,
              name: cell.format.font.name,
              size: cell.format.font.size,
              underline: cell.format.font.underline,
            },
            fill: {
              color: cell.format.fill.color || null,
            },
            numberFormat: cell.numberFormat as string, // Cast to string
            horizontalAlignment: cell.format.horizontalAlignment,
            verticalAlignment: cell.format.verticalAlignment,
            wrapText: cell.format.wrapText,
            borders: cell.format.borders,
          };
          output.headerRowStyle.push(style);
        }
         console.log("Header row style captured:", output.headerRowStyle);


        // --- Capture First Data Row (Row 1) Style (if range has more than 1 row) ---
        if (range.rowCount > 1) {
          const dataRowRange = range.getRow(1);
           dataRowRange.load([ // Load specific properties for the row
             "format/font/bold",
             "format/font/italic",
             "format/font/color",
             "format/fill/color",
             "format/horizontalAlignment",
             "format/verticalAlignment",
             "format/wrapText",
             "format/borders",
             "numberFormat" // Load numberFormat directly
           ]);
           await context.sync(); // Sync again

          for (let j = 0; j < range.columnCount; j++) {
            const cell = dataRowRange.getCell(0, j);
            cell.load([ // Load specific properties for the cell
                "format/font/bold",
                "format/font/italic",
                "format/font/color",
                "format/font/name",
                "format/font/size",
                "format/font/underline",
                "format/fill/color",
                "format/horizontalAlignment",
                "format/verticalAlignment",
                "format/wrapText",
                "format/borders",
                "numberFormat",
                "note"
            ]);
            await context.sync(); // Sync per cell

            const style: CellStyle = {
              font: {
                bold: cell.format.font.bold,
                italic: cell.format.font.italic,
                color: cell.format.font.color || null,
                name: cell.format.font.name,
                size: cell.format.font.size,
                underline: cell.format.font.underline,
              },
              fill: {
                color: cell.format.fill.color || null,
              },
              numberFormat: cell.numberFormat as string, // Cast to string
              horizontalAlignment: cell.format.horizontalAlignment,
              verticalAlignment: cell.format.verticalAlignment,
              wrapText: cell.format.wrapText,
              borders: cell.format.borders,
            };
            output.dataRowStyle.push(style);
          }
          console.log("Data row style captured:", output.dataRowStyle);
        } else {
          console.log("Range has only one row, skipping data row style capture.");
          // Optionally copy header style to data style if only one row exists
          // output.dataRowStyle = output.headerRowStyle;
        }

        return output;
      });
    } catch (error) {
      console.error("--- Error reading selected range formatting --- ", error);
      if (error instanceof OfficeExtension.Error) {
        if (error.code === "ItemNotFound" || error.code === "InvalidSelection") {
          throw new Error("No range selected or invalid selection. Please select cells in the sheet.");
        } else if (error.code === "GeneralException" && error.message.includes("empty")) {
           throw new Error("Selected range appears empty.");
        }
         // Log specific Office error details
         console.error(`OfficeExtension Error Code: ${error.code}`);
         console.error(`OfficeExtension Error Message: ${error.message}`);
         console.error(`OfficeExtension Error Debug Info: ${JSON.stringify(error.debugInfo)}`);
      } else if (error instanceof Error) {
          // Rethrow known errors
          if (error.message.includes("No range selected") || error.message.includes("Selected range is empty") || error.message.includes("appears empty")) {
              throw error;
          }
      }
      // Fallback for unexpected errors
      console.error("Unexpected error reading selected range formatting:", error);
      throw new Error("An unexpected error occurred while reading the selected range formatting.");
    }
  }

  /**
   * Applies a list of operations to the active worksheet.
   * For P2, this will apply a hardcoded operation for testing.
   * @param ops An array of ActionOp objects.
   */
  async applyOps(ops: ActionOp[]): Promise<void> {
    console.log("Applying operations:", ops);
    try {
      await Excel.run(async (context) => {
        const sheet = context.workbook.worksheets.getActiveWorksheet();

        // Iterate through `ops` and apply them dynamically
        for (const op of ops) {
          console.log("Processing operation:", op);
          const targetRange = sheet.getRange(op.range);

          if (op.type === "write" && op.values) {
            // Check if the values are color names - <<< KEEPING THIS OLD LOGIC FOR NOW >>>
            // We will eventually remove this and apply formatting separately
            const firstValue = op.values[0]?.[0];
            if (typeof firstValue === 'string' && this.getColorHex(firstValue.toLowerCase())) {
              // If it's a color name, treat it as a color operation
              const colorHex = this.getColorHex(firstValue.toLowerCase());
              if (colorHex) {
                targetRange.format.font.color = colorHex;
                console.log("Font color set successfully to", colorHex);
              }
            } else {
              // Otherwise, treat it as a normal write operation
              // Ensure values is a 2D array
              const valuesToWrite = Array.isArray(op.values[0]) ? op.values : [op.values]; // Basic check/fix
              targetRange.values = valuesToWrite;
            }
          } else if (op.type === "formula" && op.formula) {
            // Load and sync properties needed for this specific formula op
            targetRange.load("rowCount, columnCount");
            await context.sync();
            // If op.range is a single cell, formulas should be a 2D array
            if (targetRange.rowCount === 1 && targetRange.columnCount === 1) {
              targetRange.formulas = [[op.formula]];
            } else {
              // If the range is larger, fill all cells with the formula (may be improved)
              targetRange.formulas = Array(targetRange.rowCount)
                .fill([])
                .map(() => Array(targetRange.columnCount).fill(op.formula));
            }
          } else {
            // Check if it's just a type mismatch (e.g., write op without values)
            if (op.type === "write" && !op.values) {
                 console.warn(`Write operation missing 'values' for op:`, op);
            } else if (op.type === "formula" && !op.formula) {
                 console.warn(`Formula operation missing 'formula' for op:`, op);
            } else {
                 console.warn(`Unknown op type or missing data for op:`, op);
            }
          }
        }

        await context.sync();
      });
      console.log("Finished applying operations.");
    } catch (error) {
      console.error("Error applying operations:", error);
      throw error;
    }
  }

  private getColorHex(colorName: string): string | null {
    const colorMap: { [key: string]: string } = {
      blue: "#4F81BD",    // Excel Accent 1
      green: "#9BBB59",   // Excel Accent 3
      red: "#FF0000",
      yellow: "#FFFF00",
      orange: "#FFA500",
      purple: "#800080",
      gray: "#808080",
      black: "#000000",
      white: "#FFFFFF"
    };
    return colorMap[colorName.toLowerCase()] || null;
  }

  /**
   * Gets the address of the currently selected range.
   * @returns A promise that resolves with the address string (e.g., "Sheet1!A1:C10").
   * @throws An error if no range is selected.
   */
  async getSelectedRangeAddress(): Promise<string> {
    console.log("Attempting to get selected range address...");
    try {
      return await Excel.run(async (context) => {
        const range = context.workbook.getSelectedRange();
        range.load("address");
        await context.sync();
        console.log("Selected range address loaded:", range.address);
        return range.address;
      });
    } catch (error) {
      console.error("--- Error getting selected range address --- ", error);
      if (error instanceof OfficeExtension.Error && error.code === "ItemNotFound") {
          throw new Error("No range selected. Please select cells in the sheet.");
      } else {
          console.error("Unexpected error getting selected range address:", error);
          throw new Error("An unexpected error occurred while getting the selected range address.");
      }
    }
  }

  /**
   * Reads data from a specific range address.
   * @param address The range address (e.g., "Sheet1!A1:C10").
   * @returns A promise that resolves with a 2D array of strings (range data).
   */
  async getRangeData(address: string): Promise<string[][]> {
    console.log(`Attempting to read data from range: ${address}`);
    try {
      return await Excel.run(async (context) => {
        const sheet = context.workbook.worksheets.getActiveWorksheet(); // Assuming active sheet for now
        const range = sheet.getRange(address);
        range.load("values");
        await context.sync();
        console.log(`Data loaded from ${address}:`, range.values);
        // Convert all values to strings
        return range.values.map(row =>
          row.map(cell => cell === null || cell === undefined ? "" : String(cell))
        );
      });
    } catch (error) {
      console.error(`--- Error reading data from range ${address} --- `, error);
      throw new Error(`Failed to read data from range ${address}.`); // Generic error for simplicity
    }
  }

  // --- NEW: Moved Helper Function to Apply CellStyle ---
  private applyCellStyle(range: Excel.Range, style: CellStyle | undefined | null) {
    if (!style) return; // Skip if no style provided

    // Font properties
    if (style.font) {
        if (style.font.bold !== undefined) range.format.font.bold = style.font.bold;
        if (style.font.italic !== undefined) range.format.font.italic = style.font.italic;
        if (style.font.color) range.format.font.color = style.font.color;
        if (style.font.name) range.format.font.name = style.font.name;
        if (style.font.size) range.format.font.size = style.font.size;
        if (style.font.underline) range.format.font.underline = style.font.underline as Excel.RangeUnderlineStyle;
        // Add other font props like name, size here if captured
    }
    // Fill properties
    if (style.fill) {
         if (style.fill.color) range.format.fill.color = style.fill.color;
    }
    // Number format
    if (style.numberFormat) range.numberFormat = style.numberFormat as unknown as any; // Cast via unknown to any
    // Alignment
    if (style.horizontalAlignment) range.format.horizontalAlignment = style.horizontalAlignment as Excel.HorizontalAlignment;
    if (style.verticalAlignment) range.format.verticalAlignment = style.verticalAlignment as Excel.VerticalAlignment;
    if (style.font?.underline) range.format.font.underline = style.font.underline as Excel.RangeUnderlineStyle;
    if (style.wrapText) range.format.wrapText = style.wrapText;
    // Add borders, wrapText etc. here if captured

    // IMPORTANT: This helper does NOT call context.sync()
  }

  // --- NEW: Function to apply plan with formatting ---
  async applyFormattedPlan(backendResult: BackendPlanResult, formatting: RangeFormatting): Promise<void> {
    console.log("Applying formatted plan...");
    // Log received calculated values for debugging
    console.log("Received calculated_values:", JSON.stringify(backendResult.calculated_values, null, 2));
    console.log("Received formatting object:", formatting); // Log formatting too

    try {
      await Excel.run(async (context) => {
        const sheet = context.workbook.worksheets.getActiveWorksheet();

        // --- Helper Functions for Address Manipulation ---
        // (Consider moving these to a utility file later)
        const colToNum = (colStr: string): number => {
            let num = 0;
            for (let i = 0; i < colStr.length; i++) {
                num = num * 26 + (colStr.charCodeAt(i) - 64); // A=1
            }
            return num;
        };

        const numToCol = (n: number): string => {
            let string = "";
            while (n > 0) {
                const remainder = (n - 1) % 26;
                string = String.fromCharCode(65 + remainder) + string;
                n = Math.floor((n - 1) / 26);
            }
            return string;
        };
        // -----------------------------------------------

        // --- 1. Parse Input Address & Calculate Output Start ---
        const inputAddress = formatting.address.split('!')[1]; // Remove sheet name if present
        const match = inputAddress.match(/([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?/);
        if (!match) {
            throw new Error(`Could not parse input address: ${inputAddress}`);
        }
        const startColStr = match[1];
        const startRow = parseInt(match[2], 10);
        const endColStr = match[3] || startColStr; // Handle single cell selection
        // const endRow = match[4] ? parseInt(match[4], 10) : startRow; // Input end row

        const endColNum = colToNum(endColStr);
        const outputStartColNum = endColNum + 2; // Start 2 columns right
        const outputStartColLetter = numToCol(outputStartColNum);
        const outputStartRow = startRow;
        let currentRow = outputStartRow;

        console.log(`Input Address Parsed: ${inputAddress}`);
        console.log(`Output starting at: ${outputStartColLetter}${outputStartRow}`);

        // --- NEW: Clear potential output area before writing ---
        const approxInputRows = 6; // Header + 4 inputs + 1 space
        const approxCalcRows = 4;  // Header + 2 calcs + 1 space
        const approxInvestorRows = (backendResult.calculated_values?.parsed_investors?.length || 0) + 1 /*NewInv*/ + 1 /*Pool*/ + 1 /*Total*/;
        const bufferRows = 10; // Add buffer for safety/future changes
        const estimatedMaxRow = outputStartRow + approxInputRows + approxCalcRows + approxInvestorRows + bufferRows;
        const outputEndColNum = outputStartColNum + 3; // Assuming 4 output columns max
        const outputEndColLetter = numToCol(outputEndColNum);
        const clearRangeAddress = `${outputStartColLetter}${outputStartRow}:${outputEndColLetter}${estimatedMaxRow}`;
        console.log(`Clearing estimated output range: ${clearRangeAddress}`);
        const clearRange = sheet.getRange(clearRangeAddress);
        clearRange.clear(Excel.ClearApplyTo.all); // Clear contents, formatting, notes
        await context.sync(); // Sync the clear operation
        // -----------------------------------------------------

        // --- 2. Extract Calculated Data from backendResult ---
        // (Assuming backendResult structure matches server/main.py update)
        const slots = backendResult.slots || {};
        const calculated_values = backendResult.calculated_values || {};
        // const final_share_counts = calculated_values.final_share_counts || {};
        // const final_ownership_pct = calculated_values.final_ownership_pct || {};
        // const parsed_investors = calculated_values.parsed_investors || [];
        // const column_mapping = backendResult.column_mapping || {};


        // --- 3. Iterate and Apply Data + Formatting ---

        // Style Mapping Strategy (Initial Simple Version):
        // - Use Header Style for all output labels/headers.
        // - Use Data Style for all output values.
        // - Apply style based on the *relative column index* (0, 1, 2...) of the output block.
        const getHeaderStyle = (outputColIndex: number): CellStyle | undefined | null => {
             // Try to get style from corresponding input column, default to first column style or null
             return formatting.headerRowStyle?.[outputColIndex] ?? formatting.headerRowStyle?.[0] ?? null;
        }
        const getDataStyle = (outputColIndex: number): CellStyle | undefined | null => {
             // Try to get style from corresponding input column, default to first column style or null
             return formatting.dataRowStyle?.[outputColIndex] ?? formatting.dataRowStyle?.[0] ?? null;
        }


        // --- Block 1: Round Inputs ---
        console.log("Applying Round Inputs block...");
        const inputCol1Letter = outputStartColLetter;
        const inputCol2Letter = numToCol(outputStartColNum + 1);

        // Header
        const roundInputHeaderRange = sheet.getRange(`${inputCol1Letter}${currentRow}`);
        roundInputHeaderRange.values = [["Round Inputs"]];
        this.applyCellStyle(roundInputHeaderRange, getHeaderStyle(0)); // Apply style from input col 0
        currentRow++;

        // Round Type
        const rtLabelRange = sheet.getRange(`${inputCol1Letter}${currentRow}`);
        const rtValueRange = sheet.getRange(`${inputCol2Letter}${currentRow}`);
        rtLabelRange.values = [["Round Type"]];
        rtValueRange.values = [[slots.roundType || ""]];
        this.applyCellStyle(rtLabelRange, getHeaderStyle(0)); // Label style from input col 0
        this.applyCellStyle(rtValueRange, getDataStyle(1));   // Value style from input col 1 (arbitrary choice for now)
        currentRow++;

        // Amount ($M)
        const amountLabelRange = sheet.getRange(`${inputCol1Letter}${currentRow}`);
        const amountValueRange = sheet.getRange(`${inputCol2Letter}${currentRow}`);
        const amountM = slots.amount ? slots.amount / 1000000 : null;
        amountLabelRange.values = [["Amount ($M)"]];
        amountValueRange.values = [[amountM]];
        this.applyCellStyle(amountLabelRange, getHeaderStyle(0));
        // Try to find an input currency/number style for the value
        const amountStyle = getDataStyle(1) || getDataStyle(2) || getDataStyle(0); // Check cols 1, 2, 0 for data style
        this.applyCellStyle(amountValueRange, amountStyle);
        currentRow++;

        // Pre-Money ($M)
        const pmLabelRange = sheet.getRange(`${inputCol1Letter}${currentRow}`);
        const pmValueRange = sheet.getRange(`${inputCol2Letter}${currentRow}`);
        const preMoneyM = slots.preMoney ? slots.preMoney / 1000000 : null;
        pmLabelRange.values = [["Pre-Money ($M)"]];
        pmValueRange.values = [[preMoneyM]];
        this.applyCellStyle(pmLabelRange, getHeaderStyle(0));
        // Use same style logic as Amount
        this.applyCellStyle(pmValueRange, amountStyle);
        currentRow++;

        // Pool Pct (%)
        const poolLabelRange = sheet.getRange(`${inputCol1Letter}${currentRow}`);
        const poolValueRange = sheet.getRange(`${inputCol2Letter}${currentRow}`);
        poolLabelRange.values = [["Pool Pct (%)"]];
        poolValueRange.values = [[slots.poolPct || null]]; // Write as number (e.g., 10)
        this.applyCellStyle(poolLabelRange, getHeaderStyle(0));
        // Try to find a percentage style, fallback to amount/generic style
        const poolStyle = (formatting.dataRowStyle || []).find(s => s.numberFormat?.includes('%')) || amountStyle;
        this.applyCellStyle(poolValueRange, poolStyle);
        // Ensure number format is percentage if found or set default
        if ((poolValueRange.numberFormat as unknown as string) === 'General' || !(poolValueRange.numberFormat as unknown as string)?.includes('%')) {
             poolValueRange.numberFormat = '0%' as unknown as any; // Cast via unknown
        }
        currentRow++;

        // Skip a row
        currentRow += 1;


        // --- Block 2: Calculations ---
        console.log("Applying Calculations block...");
        const calcCol1Letter = outputStartColLetter;
        const calcCol2Letter = numToCol(outputStartColNum + 1);
        const calcHeaderStyle = getHeaderStyle(0); // Reuse style logic
        const calcValueStyle = getDataStyle(1) || getDataStyle(2) || getDataStyle(0); // Reuse style logic

        // Header
        const calcHeaderRange = sheet.getRange(`${calcCol1Letter}${currentRow}`);
        calcHeaderRange.values = [["Calculations"]];
        this.applyCellStyle(calcHeaderRange, calcHeaderStyle);
        currentRow++;

        // Post-Money ($M)
        const pmvLabelRange = sheet.getRange(`${calcCol1Letter}${currentRow}`);
        const pmvValueRange = sheet.getRange(`${calcCol2Letter}${currentRow}`);
        const pmv = calculated_values.post_money_valuation;
        const pmvM = pmv ? pmv / 1000000 : null;
        pmvLabelRange.values = [["Post-Money ($M)"]];
        pmvValueRange.values = [[pmvM]];
        this.applyCellStyle(pmvLabelRange, calcHeaderStyle);
        this.applyCellStyle(pmvValueRange, calcValueStyle); // Apply general data/currency style
        currentRow++;

        // Price per Share
        const ppsLabelRange = sheet.getRange(`${calcCol1Letter}${currentRow}`);
        const ppsValueRange = sheet.getRange(`${calcCol2Letter}${currentRow}`);
        const pps = calculated_values.price_per_share;
        ppsLabelRange.values = [["Price per Share"]];
        ppsValueRange.values = [[pps]];
        this.applyCellStyle(ppsLabelRange, calcHeaderStyle);
        // Apply similar style, maybe force more decimal places if needed?
        this.applyCellStyle(ppsValueRange, calcValueStyle);
        // Optionally force a specific number format for price/share
        // if (ppsValueRange.format.numberFormat === 'General') { // Example condition
        //    ppsValueRange.format.numberFormat = '$#,##0.0000'; 
        // }
        currentRow++;

        // Skip row before next section
        currentRow += 1;


        // --- Block 3: Post-Money Cap Table ---
        console.log("Applying Post-Money Cap Table block...");
        const capTableStartRow = currentRow;
        // Define output columns
        const col1 = outputStartColLetter;
        const col2 = numToCol(outputStartColNum + 1);
        const col3 = numToCol(outputStartColNum + 2);
        const col4 = numToCol(outputStartColNum + 3);

        // Extract data needed for the table
        const final_share_counts = calculated_values.final_share_counts || {};
        const final_ownership_pct = calculated_values.final_ownership_pct || {};
        const parsed_investors = calculated_values.parsed_investors || [];

        // --- Write Table Headers ---
        const headerRowRange = sheet.getRange(`${col1}${currentRow}:${col4}${currentRow}`);
        // Define header values
        headerRowRange.values = [["Shareholder", "Investment ($)", "Shares", "% Ownership"]];
        // Apply formatting - Loop through header styles from input
        for (let j = 0; j < 4; j++) { // Assuming 4 output columns
             const headerCellRange = sheet.getRange(`${numToCol(outputStartColNum + j)}${currentRow}`);
             // Try to map input style: Col 0->0, Col 1->1(Invest), Col 2->2(Shares), Col 3->Last input col(%)?
             let inputStyleIndex = j;
             if (j === 1) inputStyleIndex = 1; // Assuming Investment is typically col 1
             if (j === 2) inputStyleIndex = 2; // Assuming Shares is typically col 2
             if (j === 3) inputStyleIndex = formatting.columnCount - 1; // Assume % is last input column
             this.applyCellStyle(headerCellRange, getHeaderStyle(inputStyleIndex));
        }
        currentRow++;

        // --- Write Existing Investor Rows ---
        const dataRowRanges: Excel.Range[] = []; // Collect ranges for potential batch formatting
        for (const investor of parsed_investors) {
            // --- SKIP Placeholder/Empty Rows ---
            if (!investor || !investor.name || investor.name.toLowerCase() === 'shareholder') { // Add more conditions if needed
                 console.log(`Skipping empty/placeholder investor row: ${investor?.name}`);
                 continue; // Skip to the next investor
            }
            // ----------------------------------

            const name = investor.name;
            const investment = investor.investment;
            const finalShares = final_share_counts[name];
            const finalPct = final_ownership_pct[name];

            const nameRange = sheet.getRange(`${col1}${currentRow}`);
            const invRange = sheet.getRange(`${col2}${currentRow}`);
            const sharesRange = sheet.getRange(`${col3}${currentRow}`);
            const pctRange = sheet.getRange(`${col4}${currentRow}`);

            nameRange.values = [[name]];
            invRange.values = [[investment]];
            sharesRange.values = [[finalShares]];
            pctRange.values = [[finalPct]]; // Write percentage as a number (e.g., 0.1 for 10%)

            // Apply styles - map similarly to headers
            this.applyCellStyle(nameRange, getDataStyle(0)); // Name style from input col 0
            this.applyCellStyle(invRange, getDataStyle(1)); // Investment style from input col 1
            this.applyCellStyle(sharesRange, getDataStyle(2)); // Shares style from input col 2
            const pctStyle = getDataStyle(formatting.columnCount - 1); // % style from last input col
            this.applyCellStyle(pctRange, pctStyle);
            // Ensure % format
             if ((pctRange.numberFormat as unknown as string) === 'General' || !(pctRange.numberFormat as unknown as string)?.includes('%')) {
                 pctRange.numberFormat = '0.0%' as unknown as any; // Cast via unknown
            }
            
            dataRowRanges.push(nameRange, invRange, sharesRange, pctRange);
            currentRow++;
        }

        // --- Write New Investors Row ---
        const newInvShares = final_share_counts["New Investors"];
        const newInvPct = final_ownership_pct["New Investors"];
        const newInvNameRange = sheet.getRange(`${col1}${currentRow}`);
        const newInvInvRange = sheet.getRange(`${col2}${currentRow}`);
        const newInvSharesRange = sheet.getRange(`${col3}${currentRow}`);
        const newInvPctRange = sheet.getRange(`${col4}${currentRow}`);

        newInvNameRange.values = [["New Investors"]];
        newInvInvRange.values = [[slots.amount || 0]];
        newInvSharesRange.values = [[newInvShares]];
        newInvPctRange.values = [[newInvPct]];

        this.applyCellStyle(newInvNameRange, getDataStyle(0));
        this.applyCellStyle(newInvInvRange, getDataStyle(1));
        this.applyCellStyle(newInvSharesRange, getDataStyle(2));
        this.applyCellStyle(newInvPctRange, getDataStyle(formatting.columnCount - 1));
        if ((newInvPctRange.numberFormat as unknown as string) === 'General' || !(newInvPctRange.numberFormat as unknown as string)?.includes('%')) {
             newInvPctRange.numberFormat = '0.0%' as unknown as any; // Cast via unknown
        }
        dataRowRanges.push(newInvNameRange, newInvInvRange, newInvSharesRange, newInvPctRange);
        currentRow++;

        // --- Write Option Pool Row ---
        const poolShares = final_share_counts["Option Pool"];
        const poolPct = final_ownership_pct["Option Pool"];
        const poolNameRange = sheet.getRange(`${col1}${currentRow}`);
        const poolInvRange = sheet.getRange(`${col2}${currentRow}`);
        const poolSharesRange = sheet.getRange(`${col3}${currentRow}`);
        const poolPctRange = sheet.getRange(`${col4}${currentRow}`);

        poolNameRange.values = [["Option Pool"]];
        poolInvRange.values = [[null]]; // No investment
        poolSharesRange.values = [[poolShares]];
        poolPctRange.values = [[poolPct]];

        this.applyCellStyle(poolNameRange, getDataStyle(0));
        this.applyCellStyle(poolInvRange, getDataStyle(1)); // Apply investment style even though null?
        this.applyCellStyle(poolSharesRange, getDataStyle(2));
        this.applyCellStyle(poolPctRange, getDataStyle(formatting.columnCount - 1));
        if ((poolPctRange.numberFormat as unknown as string) === 'General' || !(poolPctRange.numberFormat as unknown as string)?.includes('%')) {
             poolPctRange.numberFormat = '0%' as unknown as any; // Cast via unknown
        }
        dataRowRanges.push(poolNameRange, poolInvRange, poolSharesRange, poolPctRange);
        currentRow++;

        // --- Write Totals Row ---
        const totalRow = currentRow;
        const totalLabelRange = sheet.getRange(`${col1}${totalRow}`);
        const totalInvRange = sheet.getRange(`${col2}${totalRow}`);
        const totalSharesRange = sheet.getRange(`${col3}${totalRow}`);
        const totalPctRange = sheet.getRange(`${col4}${totalRow}`);

        totalLabelRange.values = [["Total"]];
        // Apply formula (Note: capTableStartRow is the header row, data starts row below)
        totalInvRange.formulas = [[`=SUM(${col2}${capTableStartRow + 1}:${col2}${totalRow - 1})`]];
        totalSharesRange.formulas = [[`=SUM(${col3}${capTableStartRow + 1}:${col3}${totalRow - 1})`]];
        totalPctRange.formulas = [[`=SUM(${col4}${capTableStartRow + 1}:${col4}${totalRow - 1})`]];

        // Apply formatting (maybe use header style for Total label, data style for sums?)
        this.applyCellStyle(totalLabelRange, getHeaderStyle(0)); 
        this.applyCellStyle(totalInvRange, getDataStyle(1)); 
        this.applyCellStyle(totalSharesRange, getDataStyle(2));
        this.applyCellStyle(totalPctRange, getDataStyle(formatting.columnCount - 1));
         if ((totalPctRange.numberFormat as unknown as string) === 'General' || !(totalPctRange.numberFormat as unknown as string)?.includes('%')) {
             totalPctRange.numberFormat = '0.0%' as unknown as any; // Cast via unknown
        }

        // --- IMPORTANT: Batching and Syncing ---
        // Currently applying formatting cell-by-cell. This might be slow.
        // Consider loading all ranges first, setting values/formulas,
        // then applying formats in batches before the final sync.

        await context.sync(); // Sync changes at the end
        console.log("Formatted plan applied (Round Inputs section done).");
      });
    } catch (error) {
      console.error("Error applying formatted plan:", error);
      throw error; // Rethrow to be caught by caller
    }
  }

  // --- NEW: State for preview functionality ---
  private originalCellData: { [rangeAddress: string]: OriginalCellState } = {};
  private previewAppliedRanges: string[] = [];
  private readonly PREVIEW_COLOR = "#F0F0F0"; // Light Grey

  // --- NEW: Helper to load detailed format for a range/cell ---
  private loadDetailedFormat(item: Excel.Range | Excel.RangeAreas | Excel.Worksheet) {
    // Load specific properties instead of the whole 'format' object
    item.load([
      "format/font/bold",
      "format/font/italic",
      "format/font/color",
      "format/font/name",
      "format/font/size",
      "format/font/underline",
      "format/fill/color",
      "format/horizontalAlignment",
      "format/verticalAlignment",
      "format/wrapText",
      "format/borders",
      "numberFormat",
      "format/font/italic",
    ]);
  }

  // --- NEW: Helper to capture detailed formatting for a range ---
  private async captureRangeFormatting(context: Excel.RequestContext, range: Excel.Range): Promise<CellStyle[][]> {
    // Load necessary properties for the entire range first
    range.load(["rowCount", "columnCount"]);
    // No need to loadDetailedFormat here, do it per cell for accuracy
    await context.sync();

    const rows = range.rowCount;
    const cols = range.columnCount;
    const capturedFormatting: CellStyle[][] = Array(rows).fill(null).map(() => Array(cols).fill({}));

    // --- Cell-by-cell loading (Accurate but slower) ---
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const cell = range.getCell(i, j);
        this.loadDetailedFormat(cell); // Includes loading numberFormat directly on the cell
        await context.sync(); // Sync per cell
        
        const cellFormat = cell.format; // Access format properties

        capturedFormatting[i][j] = {
            font: {
              bold: cellFormat.font?.bold,
              italic: cellFormat.font?.italic,
              color: cellFormat.font?.color || null,
              name: cellFormat.font?.name,
              size: cellFormat.font?.size,
              underline: cellFormat.font?.underline,
            },
            fill: {
              color: cellFormat.fill?.color || null,
            },
            numberFormat: cell.numberFormat, // Correct: access directly from cell
            horizontalAlignment: cellFormat.horizontalAlignment,
            verticalAlignment: cellFormat.verticalAlignment,
            wrapText: cellFormat.wrapText,
            borders: cellFormat.borders,
        };
      }
    }
    return capturedFormatting;
  }

  // --- NEW: Helper to restore detailed formatting for a range ---
  private async restoreRangeFormatting(context: Excel.RequestContext, range: Excel.Range, formatting: CellStyle[][], skipFill?: boolean) {
      const rows = formatting.length;
      if (rows === 0) return;
      const cols = formatting[0].length;
      if (cols === 0) return;

      // Optimize by setting formats column by column or row by row if possible?
      // For now, cell-by-cell restoration for accuracy.
      for (let i = 0; i < rows; i++) {
          for (let j = 0; j < cols; j++) {
              const cell = range.getCell(i, j);
              const style = formatting[i][j];
              // Create a temporary style object to potentially modify
              let styleToApply = {...style};
              
              // Conditionally skip restoring fill
              if (skipFill && styleToApply.fill) {
                  styleToApply.fill = { ...styleToApply.fill, color: undefined }; // Remove color property
              }

              this.applyCellStyle(cell, styleToApply); // Use the potentially modified style
          }
      }
      // No need to sync here, assume it happens after the loop in the calling function
  }

  /**
   * Applies a set of operations (write values or formulas) to the sheet.
   * NOTE: This applies changes directly without preview.
   * @param ops An array of ActionOp objects.
   */
  async applyPreview(ops: ActionOp[]): Promise<void> {
    console.log("Applying preview for ops:", ops);
    try {
      await Excel.run(async (context) => {
        const sheet = context.workbook.worksheets.getActiveWorksheet();

        // Clear previous preview state
        this.originalCellData = {};
        this.previewAppliedRanges = [];

        for (const op of ops) {
          if (!op.range) continue; // Skip ops without a range

          console.log(`Applying preview for op ${op.id} on range ${op.range}`);
          const range = sheet.getRange(op.range);

          // 1. Store original state
          range.load(["address", "values"]);
          // Load detailed format (more robustly)
          this.loadDetailedFormat(range);
          await context.sync();

          const originalValues = range.values;
          // Use the more detailed capture function
          const originalFormatting = await this.captureRangeFormatting(context, range);

          this.originalCellData[range.address] = { values: originalValues, formatting: originalFormatting };
          this.previewAppliedRanges.push(range.address);
          console.log(`Stored original state for ${range.address}`);

          // 2. Apply operation value/formula
          if (op.type === "write" && op.values) {
            range.values = op.values;
          } else if (op.type === "formula" && op.formula) {
            // Apply formula to the first cell if it's a single cell range, or fill if multi-cell?
            // Assuming apply to whole range for now.
            range.formulas = [[op.formula]]; // Basic assumption, might need adjustment for multi-cell
             // If op.formula should apply to all cells in the range:
             // const formulas = Array(range.rowCount).fill(Array(range.columnCount).fill(op.formula));
             // range.formulas = formulas;
          }

          // 3. Apply preview formatting (border only)
          // range.format.fill.color = this.PREVIEW_COLOR; // REMOVED FILL
          // range.format.font.italic = true; // REMOVED ITALIC
          // Apply border
          range.format.borders.load("items/style, items/color, items/weight"); // Load border items before setting
          await context.sync();
          const edges = [Excel.BorderIndex.edgeTop, Excel.BorderIndex.edgeBottom, Excel.BorderIndex.edgeLeft, Excel.BorderIndex.edgeRight];
          edges.forEach(edge => {
            range.format.borders.getItem(edge).style = Excel.BorderLineStyle.dash;
            range.format.borders.getItem(edge).color = "#0078D4"; // Blue
            range.format.borders.getItem(edge).weight = Excel.BorderWeight.thin;
          });

          await context.sync(); // Sync after each op modification
          console.log(`Applied preview changes for ${range.address}`);
        }
      });
    } catch (error) {
      console.error("--- Error applying preview --- ", error);
       if (error instanceof OfficeExtension.Error) {
           console.error(`OfficeExtension Error Code: ${error.code}`);
           console.error(`OfficeExtension Error Debug Info: ${JSON.stringify(error.debugInfo)}`);
       }
      throw error; // Re-throw to be handled by the caller
    }
  }

  // --- NEW: Accept Preview --- 
  async acceptPreview(backendResult: BackendPlanResult, formatting: RangeFormatting): Promise<void> {
    console.log("Accepting preview by clearing border and re-applying final plan...");
    // We no longer need previewAppliedRanges here, as applyFormattedPlan overwrites everything.
    // if (this.previewAppliedRanges.length === 0) { ... } 

    try {
      await Excel.run(async (context) => {
        const sheet = context.workbook.worksheets.getActiveWorksheet();
        console.log("Clearing preview borders first...");
        // 1. Explicitly clear preview borders
        for (const address of this.previewAppliedRanges) {
            const range = sheet.getRange(address);
            range.format.borders.load("items/style");
            await context.sync();
            range.format.borders.items.forEach(border => {
                border.style = Excel.BorderLineStyle.none;
            });
            console.log(`Cleared preview border for ${address}`);
        }
        await context.sync(); // Sync all border clears together
        console.log("Preview borders cleared. Now applying final plan...");

        // 2. Call the original function to guarantee the correct final state
        await this.applyFormattedPlan(backendResult, formatting);
        console.log("Final plan applied successfully over preview areas.");
        
        // 3. Clear internal preview state AFTER successful application
        this.originalCellData = {};
        this.previewAppliedRanges = [];
      });
    } catch (error) {
      console.error("--- Error accepting preview (by applying final plan) --- ", error);
      // Don't clear state on error, user might want to retry reject
      throw error; // Re-throw
    }
  }

  // --- NEW: Reject Preview --- 
  async rejectPreview(): Promise<void> {
    console.log("Rejecting preview for ranges:", this.previewAppliedRanges);
     if (this.previewAppliedRanges.length === 0) {
         console.log("No preview ranges to reject.");
         return; // Nothing to do
     }
    try {
      await Excel.run(async (context) => {
        const sheet = context.workbook.worksheets.getActiveWorksheet();
        // Process in reverse order? Doesn't usually matter for restoration.
        for (const address of this.previewAppliedRanges) {
            console.log(`Rejecting preview for range: ${address}`);
            const originalState = this.originalCellData[address];
            if (!originalState) {
                console.warn(`Original state not found for ${address}, cannot revert precisely.`);
                continue;
            }

            const range = sheet.getRange(address);

            // 1. Restore original values
            range.values = originalState.values;
            console.log(`Restored values for ${address}`);

            // 2. Restore original formatting (cell by cell)
            await this.restoreRangeFormatting(context, range, originalState.formatting);
            console.log(`Restored formatting for ${address}`);
            
            await context.sync(); // Sync after restoring each range
            console.log(`Reverted changes for ${address}`);
        }

        // Clear state after successful rejection
        this.originalCellData = {};
        this.previewAppliedRanges = [];
      });
    } catch (error) {
      console.error("--- Error rejecting preview --- ", error);
      if (error instanceof OfficeExtension.Error) {
           console.error(`OfficeExtension Error Code: ${error.code}`);
           console.error(`OfficeExtension Error Debug Info: ${JSON.stringify(error.debugInfo)}`);
       }
      // Don't clear state on error, user might want to retry reject/accept
      throw error; // Re-throw
    }
  }
}
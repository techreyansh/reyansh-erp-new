import sheetService from './sheetService';

class CostingService {
  constructor() {
    this.sheetName = 'Costing';
  }

  async initializeSheet() {
    try {
      const headers = [
        'Costing ID',
        'Date',
        'Specifications',
        'Cu Strands',
        'Gauge',
        'Inner OD',
        'Bunch',
        'Copper Weight (Kgs/100 mtr)',
        'PVC Weight (Kgs/100 mtr)',
        'No. Of Cores',
        'Round OD',
        'Flat B',
        'Flat W',
        'Laying',
        'Final Copper (Kgs/100 mtr)',
        'Final PVC Round (Kgs/100 mtr)',
        'Final PVC Flat (Kgs/100 mtr)',
        'Copper Rate',
        'PVC Rate',
        'RMC',
        'Labour on Wire',
        'Bundle Cost',
        'Bundle Weight',
        'Cost Of Wire/Mtr',
        'Length Required',
        'Wire Cost',
        'Type (Wire/Plug)',
        'Plug Cost',
        'Terminal/Acc. Cost',
        'Cord Cost',
        'Enquiry By',
        'Company',
        'Remarks',
        'Unique'
      ];

      await sheetService.initializeSheet(this.sheetName, headers);
      return { success: true, message: 'Costing sheet initialized successfully' };
    } catch (error) {
      console.error('Error initializing costing sheet:', error);
      throw error;
    }
  }

  async addCostingEntry(data) {
    try {
      // Get the next Costing ID
      const costingId = await this.generateNextCostingId();
      
      // Calculate all the derived values
      const calculatedData = this.calculateValues(data);
      
      // Prepare the row data in the correct order
      const rowData = {
        'Costing ID': costingId,
        'Date': calculatedData.date,
        'Specifications': calculatedData.specifications,
        'Cu Strands': calculatedData.cuStrands,
        'Gauge': calculatedData.gauge,
        'Inner OD': calculatedData.innerOD,
        'Bunch': calculatedData.bunch,
        'Copper Weight (Kgs/100 mtr)': calculatedData.copperWeight,
        'PVC Weight (Kgs/100 mtr)': calculatedData.pvcWeight,
        'No. Of Cores': calculatedData.noOfCores,
        'Round OD': calculatedData.roundOD,
        'Flat B': calculatedData.flatB,
        'Flat W': calculatedData.flatW,
        'Laying': calculatedData.laying,
        'Final Copper (Kgs/100 mtr)': calculatedData.finalCopper,
        'Final PVC Round (Kgs/100 mtr)': calculatedData.finalPVCRound,
        'Final PVC Flat (Kgs/100 mtr)': calculatedData.finalPVCFlat,
        'Copper Rate': calculatedData.copperRate,
        'PVC Rate': calculatedData.pvcRate,
        'RMC': calculatedData.rmc,
        'Labour on Wire': calculatedData.labourOnWire,
        'Bundle Cost': calculatedData.bundleCost,
        'Bundle Weight': calculatedData.bundleWeight,
        'Cost Of Wire/Mtr': calculatedData.costOfWirePerMtr,
        'Length Required': calculatedData.lengthReq,
        'Wire Cost': calculatedData.wireCost,
        'Type (Wire/Plug)': calculatedData.type,
        'Plug Cost': calculatedData.plugCost,
        'Terminal/Acc. Cost': calculatedData.terminalAccCost,
        'Cord Cost': calculatedData.cordCost,
        'Enquiry By': calculatedData.enquiryBy,
        'Company': calculatedData.company,
        'Remarks': calculatedData.remarks,
        'Unique': calculatedData.unique
      };

      await sheetService.appendRow(this.sheetName, rowData);
      return { success: true, message: `Costing entry added successfully with ID: ${costingId}` };
    } catch (error) {
      console.error('Error adding costing entry:', error);
      throw error;
    }
  }

  async getAllCostingEntries() {
    try {
      const data = await sheetService.getSheetData(this.sheetName);
      return data || [];
    } catch (error) {
      console.error('Error fetching costing entries:', error);
      throw error;
    }
  }

  async generateNextCostingId() {
    try {
      const entries = await this.getAllCostingEntries();
      
      if (entries.length === 0) {
        return 'CO-0001';
      }
      
      // Find the highest existing Costing ID
      let maxNumber = 0;
      entries.forEach(entry => {
        const costingId = entry['Costing ID'];
        if (costingId && costingId.startsWith('CO-')) {
          const number = parseInt(costingId.substring(3));
          if (!isNaN(number) && number > maxNumber) {
            maxNumber = number;
          }
        }
      });
      
      // Generate next ID
      const nextNumber = maxNumber + 1;
      return `CO-${nextNumber.toString().padStart(4, '0')}`;
    } catch (error) {
      console.error('Error generating next Costing ID:', error);
      // Fallback to timestamp-based ID
      return `CO-${Date.now().toString().slice(-4)}`;
    }
  }

  calculateValues(data) {
    const {
      specifications,
      cuStrands,
      gauge,
      innerOD,
      bunch,
      laying,
      noOfCores,
      roundOD,
      flatB,
      flatW,
      labourOnWire,
      lengthReq,
      type,
      plugCost,
      terminalAccCost,
      enquiryBy,
      company,
      remarks,
      copperRate = 700,
      pvcRate = 100
    } = data;

    // Convert to numbers for calculations
    const cuStrandsNum = parseFloat(cuStrands) || 0;
    const gaugeNum = parseFloat(gauge) || 0;
    const innerODNum = parseFloat(innerOD) || 0;
    const noOfCoresNum = parseFloat(noOfCores) || 0;
    const roundODNum = parseFloat(roundOD) || 0;
    const flatBNum = parseFloat(flatB) || 0;
    const flatWNum = parseFloat(flatW) || 0;
    const labourOnWireNum = parseFloat(labourOnWire) || 12;
    const lengthReqNum = parseFloat(lengthReq) || 0;
    const plugCostNum = parseFloat(plugCost) || 0;
    const terminalAccCostNum = parseFloat(terminalAccCost) || 0;
    const copperRateNum = parseFloat(copperRate) || 700;
    const pvcRateNum = parseFloat(pvcRate) || 100;

    // Bunch % and Laying % are manual inputs (matching the costing sheet's
    // F and M columns). When blank, fall back to sensible defaults.
    const bunchPct = (bunch === "" || bunch == null) ? (cuStrandsNum > 24 ? 3 : 0) : (parseFloat(bunch) || 0);
    const layingPct = (laying === "" || laying == null) ? (noOfCoresNum > 2 ? 1 : 0) : (parseFloat(laying) || 0);
    const bunchFrac = Math.min(Math.max(bunchPct, 0) / 100, 0.95);
    const layingFrac = Math.min(Math.max(layingPct, 0) / 100, 0.95);
    const bunchNum = bunchPct;
    const layingNum = layingPct;

    // Copper Weight (Kgs/100 mtr) — base, uplifted by bunch%.
    // Excel: 0.703*D^2*C / (1 - bunch)   (the F2*G2 self-reference is a % uplift)
    const copperWeight = (0.703 * gaugeNum * gaugeNum * cuStrandsNum) / (1 - bunchFrac);

    // PVC Weight (Kgs/100 mtr) — informational; cost uses Final PVC round/flat.
    const pvcWeight = 1.67 * 0.0785 * (innerODNum * innerODNum - gaugeNum * gaugeNum * cuStrandsNum);

    // Final Copper (Kgs/100 mtr) — copper weight × cores, uplifted by laying%.
    // Excel: G2*I2 / (1 - laying)
    const finalCopper = (copperWeight * noOfCoresNum) / (1 - layingFrac);

    // Calculate Final PVC Round (Kgs/100 mtr)
    const finalPVCRound = roundODNum === 0 ? 0 : 1.67 * (0.785 * roundODNum * roundODNum - 0.785 * gaugeNum * gaugeNum * cuStrandsNum * noOfCoresNum) / 10;

    // Calculate Final PVC Flat (Kgs/100 mtr)
    const finalPVCFlat = (flatBNum === 0 || flatWNum === 0) ? 0 : 1.67 * ((flatBNum * flatWNum) - (0.785 * gaugeNum * gaugeNum * cuStrandsNum * noOfCoresNum)) / 10;

    // Calculate RMC
    const rmc = finalCopper * copperRateNum + finalPVCRound * pvcRateNum + finalPVCFlat * pvcRateNum;

    // Calculate Bundle Cost
    const bundleCost = rmc + (labourOnWireNum / 100) * rmc;

    // Calculate Bundle Weight
    const bundleWeight = finalCopper + finalPVCRound + finalPVCFlat;

    // Calculate Cost of Wire per meter
    const costOfWirePerMtr = bundleCost / 100;

    // Calculate Wire Cost
    const wireCost = costOfWirePerMtr * lengthReqNum;

    // Calculate Cord Cost
    const cordCost = wireCost + plugCostNum + terminalAccCostNum;

    // Generate unique ID
    const unique = company;

    return {
      date: new Date().toISOString(),
      specifications,
      cuStrands,
      gauge,
      innerOD,
      bunch: bunchNum.toString(),
      copperWeight: copperWeight.toFixed(4),
      pvcWeight: pvcWeight.toFixed(4),
      noOfCores,
      roundOD,
      flatB,
      flatW,
      laying: layingNum.toString(),
      finalCopper: finalCopper.toFixed(4),
      finalPVCRound: finalPVCRound.toFixed(4),
      finalPVCFlat: finalPVCFlat.toFixed(4),
      copperRate: copperRateNum,
      pvcRate: pvcRateNum,
      rmc: rmc.toFixed(2),
      labourOnWire: labourOnWireNum.toString(),
      bundleCost: bundleCost.toFixed(2),
      bundleWeight: bundleWeight.toFixed(4),
      costOfWirePerMtr: costOfWirePerMtr.toFixed(4),
      lengthReq,
      wireCost: wireCost.toFixed(2),
      type,
      plugCost,
      terminalAccCost,
      cordCost: cordCost.toFixed(2),
      enquiryBy,
      company,
      remarks,
      unique
    };
  }
}

export default new CostingService(); 
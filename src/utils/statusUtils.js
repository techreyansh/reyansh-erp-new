import config from '../config/config';

// Get readable status label from status code
export const getStatusLabel = (statusCode) => {
  // Handle actual status values from data first
  const actualStatusLabels = {
    'NEW': 'New',
    'IN_PROGRESS': 'In Progress',
    'COMPLETED': 'Completed',
    'PENDING': 'Pending',
    'OVERDUE': 'Overdue',
    'CANCELLED': 'Cancelled'
  };

  // If it's an actual status value, return the readable label
  if (actualStatusLabels[statusCode]) {
    return actualStatusLabels[statusCode];
  }

  // Handle stage names (fallback to original logic)
  const statusLabels = {
    [config.statusCodes.NEW]: 'New PO',
    [config.statusCodes.STORE1]: 'Store 1',
    [config.statusCodes.CABLE_PRODUCTION]: 'Cable Production',
    [config.statusCodes.STORE2]: 'Store 2',
    [config.statusCodes.MOULDING]: 'Moulding',
    [config.statusCodes.FG_SECTION]: 'FG Section',
    [config.statusCodes.DISPATCH]: 'Dispatch',
    [config.statusCodes.DELIVERED]: 'Delivered',
  };
  
  return statusLabels[statusCode] || statusCode;
};

// Get color for status
export const getStatusColor = (statusCode) => {
  // Handle actual status values from data first
  const actualStatusColors = {
    'NEW': 'primary.main', // Blue
    'IN_PROGRESS': 'warning.main', // Orange
    'COMPLETED': 'success.main', // Green
    'PENDING': 'primary.main', // Purple
    'OVERDUE': 'error.main', // Red
    'CANCELLED': 'text.disabled' // Grey
  };

  // If it's an actual status value, return the appropriate color
  if (actualStatusColors[statusCode]) {
    return actualStatusColors[statusCode];
  }

  // Handle stage names (fallback to original logic)
  const statusColors = {
    [config.statusCodes.NEW]: 'primary.main', // Blue
    [config.statusCodes.STORE1]: 'warning.main', // Orange
    [config.statusCodes.CABLE_PRODUCTION]: 'primary.main', // Purple
    [config.statusCodes.STORE2]: 'warning.main', // Dark Orange
    [config.statusCodes.MOULDING]: 'success.main', // Green
    [config.statusCodes.FG_SECTION]: 'primary.main', // Turquoise
    [config.statusCodes.DISPATCH]: 'text.primary', // Dark Blue
    [config.statusCodes.DELIVERED]: 'success.main', // Dark Green
  };

  return statusColors[statusCode] || 'text.disabled'; // Grey as default
};

// Check if the current status can be advanced
export const canAdvance = (statusCode) => {
  return statusCode !== config.statusCodes.DELIVERED;
};

// Get the next status based on current status and order type
export const getNextStatus = (currentStatus, orderType) => {
  switch (currentStatus) {
    case config.statusCodes.NEW:
      return config.statusCodes.STORE1;
      
    case config.statusCodes.STORE1:
      // If order type is cable-only, go to DISPATCH
      return orderType === 'CABLE_ONLY' ? 
        config.statusCodes.DISPATCH : 
        config.statusCodes.CABLE_PRODUCTION;
      
    case config.statusCodes.CABLE_PRODUCTION:
      // If order type is power-cord, go to STORE2, else DISPATCH
      return orderType === 'POWER_CORD' ? 
        config.statusCodes.STORE2 : 
        config.statusCodes.DISPATCH;
      
    case config.statusCodes.STORE2:
      return config.statusCodes.MOULDING;
      
    case config.statusCodes.MOULDING:
      return config.statusCodes.FG_SECTION;
      
    case config.statusCodes.FG_SECTION:
      return config.statusCodes.DISPATCH;
      
    case config.statusCodes.DISPATCH:
      return config.statusCodes.DELIVERED;
      
    default:
      return null;
  }
}; 
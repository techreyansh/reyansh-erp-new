import React from 'react';
import { Box, Typography, Chip, Grid, Card, CardContent } from '@mui/material';

// Function to get category color based on category name
const getCategoryColor = (category) => {
  const colorMap = {
    'drawing': 'primary',
    'fpa': 'secondary', 
    'pdi': 'success',
    'processChecksheet': 'warning',
    'packagingStandard': 'error',
    'bom': 'info',
    'sop': 'info',
    'pfc': 'default'
  };
  
  return colorMap[category] || 'default';
};

const ProductSpecsTab = ({ product }) => {
  if (!product) {
    return (
      <Box sx={{ p: 2, textAlign: 'center' }}>
        <Typography variant="body1" sx={{ color: 'text.secondary' }}>
          No product selected
        </Typography>
      </Box>
    );
  }

  const attachmentFields = [
    { field: 'drawing', label: 'Drawing' },
    { field: 'fpa', label: 'FPA' },
    { field: 'pdi', label: 'PDI' },
    { field: 'processChecksheet', label: 'Process Checksheet' },
    { field: 'packagingStandard', label: 'Packaging Standard' },
    { field: 'bom', label: 'BOM' },
    { field: 'sop', label: 'SOP' },
    { field: 'pfc', label: 'PFC' }
  ];

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h6" sx={{ mb: 2, fontWeight: 500, color: 'text.primary' }}>
        Product Specifications
      </Typography>
      
      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <Card sx={{
            height: '100%',
            backgroundColor: 'background.paper',
            border: '1px solid',
            borderColor: 'grey.100'
          }}>
            <CardContent sx={{ p: 2 }}>
              <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 500, color: 'text.primary' }}>
                Basic Information
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Box>
                  <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>
                    Product Code
                  </Typography>
                  <Typography variant="body1" sx={{ color: 'text.primary', fontWeight: 400 }}>
                    {product.productCode}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>
                    Product Name
                  </Typography>
                  <Typography variant="body1" sx={{ color: 'text.primary', fontWeight: 400 }}>
                    {product.productName}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>
                    Description
                  </Typography>
                  <Typography variant="body1" sx={{ color: 'text.primary', fontWeight: 400 }}>
                    {product.description}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>
                    Manpower Required
                  </Typography>
                  <Typography variant="body1" sx={{ color: 'text.primary', fontWeight: 400 }}>
                    Assembly Line: {product.assemblyLineManpower || 0} | 
                    Cable Cutting: {product.cableCuttingManpower || 0} | 
                    Molding Machine: {product.moldingMachineManpower || 0} | 
                    Packing Line: {product.packingLineManpower || 0}
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'primary.main', fontWeight: 600, mt: 1 }}>
                    Total: {parseInt(product.assemblyLineManpower || 0) + parseInt(product.cableCuttingManpower || 0) + parseInt(product.moldingMachineManpower || 0) + parseInt(product.packingLineManpower || 0)}
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        
        <Grid item xs={12} md={6}>
          <Card sx={{
            height: '100%',
            backgroundColor: 'background.paper',
            border: '1px solid',
            borderColor: 'grey.100'
          }}>
            <CardContent sx={{ p: 2 }}>
              <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 500, color: 'text.primary' }}>
                Document Attachments
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {attachmentFields.map(({ field, label }) => (
                  <Chip
                    key={field}
                    label={label}
                    variant={product[field] ? 'filled' : 'outlined'}
                    size="small"
                    sx={(theme) => ({
                      backgroundColor: product[field] ? theme.palette.grey[100] : 'transparent',
                      color: product[field] ? theme.palette.text.primary : theme.palette.text.secondary,
                      borderColor: theme.palette.divider,
                      '&:hover': {
                        backgroundColor: product[field] ? theme.palette.divider : theme.palette.grey[100]
                      }
                    })}
                  />
                ))}
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default ProductSpecsTab;

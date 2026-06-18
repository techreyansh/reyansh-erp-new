import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Card, CardContent, Typography, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Paper,
  IconButton, Button, Dialog, DialogTitle, DialogContent,
  DialogActions, Alert, Container, Chip, Grid, Avatar,
  Fab, Snackbar, TextField, InputAdornment, FormControl,
  InputLabel, Select, MenuItem, Pagination, Tooltip,
  Badge, alpha
} from '@mui/material';
import { 
  Edit, Delete, Visibility, Add, Description, Search,
  Refresh, Settings, Inventory, People,
  CheckCircle, Error as ErrorIcon, Warning, Assignment
} from '@mui/icons-material';
import { useTheme } from '@mui/material/styles';
import LoadingSpinner from '../common/LoadingSpinner';
import DocumentViewer from '../common/DocumentViewer';
import { getAllClients, updateClient } from '../../services/clientService';
import ProductForm from './ProductForm';

const ProductList = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [success, setSuccess] = useState(false);
  
  // Enhanced search and filter functionality
  const [searchTerm, setSearchTerm] = useState('');
  const [productCodeFilter, setProductCodeFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const fetchProducts = async () => {
    try {
      setLoading(true);
      setError(null); // Clear any previous errors
      const clients = await getAllClients();
      
      // Extract products from clients
      const allProducts = [];
      const seenProducts = new Set();
      
      for (const client of clients) {
        if (client.products && client.products.length > 0) {
          const clientProducts = client.products.map(product => ({
            ...product,
            clientCode: client.clientCode,
            clientName: client.clientName,
            uniqueKey: `${client.clientCode}-${product.productCode}`
          }));
          
          clientProducts.forEach(product => {
            if (!seenProducts.has(product.uniqueKey)) {
              seenProducts.add(product.uniqueKey);
              allProducts.push(product);
            }
          });
        }
      }
      
      setProducts(allProducts);
    } catch (err) {
      setError('Failed to fetch products');
      console.error('Error fetching products:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  const handleEdit = (product) => {
    setSelectedProduct(product);
    setIsFormOpen(true);
  };

  const handleDelete = async (productCode) => {
    if (window.confirm('Are you sure you want to delete this product?')) {
      try {
        // Get all clients and find the product
        const clients = await getAllClients();
        let clientWithProduct = null;
        let productIndex = -1;

        for (const client of clients) {
          if (client.products) {
            const index = client.products.findIndex(p => p.productCode === productCode);
            if (index !== -1) {
              clientWithProduct = client;
              productIndex = index;
              break;
            }
          }
        }

        if (!clientWithProduct || productIndex === -1) {
          throw new Error('Product not found');
        }

        // Remove product from client's products array
        clientWithProduct.products.splice(productIndex, 1);

        // Update the client
        await updateClient(clientWithProduct);
        
        setSuccess(true);
        fetchProducts();
      } catch (err) {
        setError('Failed to delete product');
        console.error('Error deleting product:', err);
      }
    }
  };

  const handleBOMNavigation = (product) => {
    // Navigate to BOM page using URL param so refresh preserves the filter
    const code = encodeURIComponent(product?.productCode || '');
    navigate(`/inventory/bill-of-materials?productCode=${code}`, {
      state: { focusSelection: true, autoOpenDetails: false }
    });
  };

  const handleViewFile = (fileId, fileName) => {
    setSelectedFile({ id: fileId, name: fileName });
    setIsViewerOpen(true);
  };

  const handleViewDetails = (product) => {
    setSelectedProduct(product);
    setIsDetailsOpen(true);
  };

  const handleFormClose = () => {
    setIsFormOpen(false);
    setSelectedProduct(null);
    setSuccess(true);
    fetchProducts();
  };

  // Filter and search functionality
  const filteredProducts = useMemo(() => {
    if (!products || products.length === 0) {
      return [];
    }

    const filtered = products.filter(product => {
      // Ensure product has required fields
      if (!product || !product.productCode) {
        return false;
      }

      const matchesSearch = searchTerm === '' || 
        (product.productCode?.toLowerCase().includes(searchTerm.toLowerCase()) ||
         product.productName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
         product.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
         product.clientCode?.toLowerCase().includes(searchTerm.toLowerCase()) ||
         product.clientName?.toLowerCase().includes(searchTerm.toLowerCase()));
      
      const matchesProductCode = productCodeFilter === '' || 
        product.productCode?.toLowerCase().includes(productCodeFilter.toLowerCase());
      
      return matchesSearch && matchesProductCode;
    });

    return filtered;
  }, [products, searchTerm, productCodeFilter]);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [searchTerm, productCodeFilter, categoryFilter]);

  // Pagination handlers
  const handleChangePage = (event, newPage) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  // Get paginated data
  const paginatedProducts = filteredProducts.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage
  );

  // Calculate summary metrics
  const totalProducts = products.length;
  const totalAttachments = products.reduce((sum, product) => {
    const attachmentFields = ['drawing', 'fpa', 'pdi', 'processChecksheet', 'packagingStandard', 'bom', 'sop', 'pfc'];
    return sum + attachmentFields.filter(field => product[field]).length;
  }, 0);

  if (loading) return <LoadingSpinner message="Loading products..." />;

  // Summary Cards Component
  const summaryCards = (
    <Grid container spacing={2} sx={{ mb: 3 }}>
      <Grid item xs={12} sm={6} md={3}>
        <Card sx={{
          height: '100%',
          backgroundColor: 'background.paper',
          border: '1px solid',
          borderColor: 'grey.100',
          '&:hover': {
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
          }
        }}>
          <CardContent sx={{ p: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Box sx={{
                width: 40,
                height: 40,
                backgroundColor: 'grey.100',
                borderRadius: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <Inventory sx={{ color: 'text.secondary', fontSize: 20 }} />
              </Box>
              <Box>
                <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 400 }}>
                  Total Products
                </Typography>
                <Typography variant="h6" sx={{ fontWeight: 500, color: 'text.primary' }}>
                  {totalProducts}
                </Typography>
              </Box>
            </Box>
          </CardContent>
        </Card>
      </Grid>
      <Grid item xs={12} sm={6} md={3}>
        <Card sx={{
          height: '100%',
          backgroundColor: 'background.paper',
          border: '1px solid',
          borderColor: 'grey.100',
          '&:hover': {
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
          }
        }}>
          <CardContent sx={{ p: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Box sx={{
                width: 40,
                height: 40,
                backgroundColor: 'grey.100',
                borderRadius: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <Description sx={{ color: 'text.secondary', fontSize: 20 }} />
              </Box>
              <Box>
                <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 400 }}>
                  Total Attachments
                </Typography>
                <Typography variant="h6" sx={{ fontWeight: 500, color: 'text.primary' }}>
                  {totalAttachments}
                </Typography>
              </Box>
            </Box>
          </CardContent>
        </Card>
      </Grid>
      <Grid item xs={12} sm={6} md={3}>
        <Card sx={{
          height: '100%',
          backgroundColor: 'background.paper',
          border: '1px solid',
          borderColor: 'grey.100',
          '&:hover': {
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
          }
        }}>
          <CardContent sx={{ p: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Box sx={{
                width: 40,
                height: 40,
                backgroundColor: 'grey.100',
                borderRadius: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <CheckCircle sx={{ color: 'text.secondary', fontSize: 20 }} />
              </Box>
              <Box>
                <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 400 }}>
                  Status
                </Typography>
                <Typography variant="h6" sx={{ fontWeight: 500, color: 'text.primary' }}>
                  Active
                </Typography>
              </Box>
            </Box>
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      {/* Header */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" sx={{ mb: 2, fontWeight: 500, color: 'text.primary' }}>
          Product Management
        </Typography>
        
        {/* Welcome Section */}
        <Paper sx={{
          p: 3,
          mb: 3,
          backgroundColor: 'grey.100',
          borderRadius: 2,
          border: '1px solid',
          borderColor: 'grey.100'
        }}>
          <Box sx={{ position: 'relative', zIndex: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Box>
                <Typography variant="h5" sx={{ mb: 1, fontWeight: 500, color: 'text.primary' }}>
                  Product Catalog
                </Typography>
                <Typography variant="body1" sx={{ color: 'text.secondary' }}>
                  Manage your product database efficiently
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button
                  variant="contained"
                  startIcon={<Add />}
                  onClick={() => setIsFormOpen(true)}
                  sx={{ 
                    minWidth: 120,
                    backgroundColor: 'primary.main',
                    '&:hover': { backgroundColor: 'primary.dark' }
                  }}
                >
                  Add Product
                </Button>
                <IconButton
                  onClick={fetchProducts}
                  sx={{
                    color: 'text.secondary',
                    '&:hover': { color: 'text.primary', backgroundColor: 'grey.100' }
                  }}
                  title="Refresh Products"
                >
                  <Refresh />
                </IconButton>
              </Box>
            </Box>
          </Box>
        </Paper>
      </Box>

      {summaryCards}

      {/* Search and Filter Controls */}
      <Card sx={{
        mb: 3,
        backgroundColor: 'background.paper',
        border: '1px solid',
        borderColor: 'grey.100'
      }}>
        <CardContent sx={{ p: 2 }}>
          <Typography variant="subtitle1" sx={{
            mb: 2,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            color: 'text.primary',
            fontWeight: 500
          }}>
            <Search sx={{ fontSize: 18 }} />
            Search & Filter
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              label="Search Products"
              placeholder="Search by client, product code, name, or description..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              size="small"
              sx={{ minWidth: 300, flexGrow: 1 }}
              InputProps={{
                startAdornment: <Search sx={{ mr: 1, color: 'text.secondary' }} />,
              }}
              disabled={loading}
            />
            <TextField
              label="Filter by Product Code"
              placeholder="Enter product code..."
              value={productCodeFilter}
              onChange={(e) => setProductCodeFilter(e.target.value)}
              size="small"
              sx={{ minWidth: 200 }}
              InputProps={{
                startAdornment: <Inventory sx={{ mr: 1, color: 'text.secondary' }} />,
              }}
              disabled={loading}
            />
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel>Category</InputLabel>
              <Select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                label="Category"
              >
                <MenuItem value="all">All Products</MenuItem>
                <MenuItem value="active">Active Only</MenuItem>
                <MenuItem value="inactive">Inactive Only</MenuItem>
              </Select>
            </FormControl>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
              <Typography variant="body2">
                {filteredProducts.length} product{filteredProducts.length !== 1 ? 's' : ''} found
                {productCodeFilter && (
                  <Chip
                    label={`Filtered by: ${productCodeFilter}`}
                    size="small"
                    sx={{
                      ml: 1,
                      backgroundColor: 'rgba(25, 118, 210, 0.1)',
                      color: 'primary.main',
                      fontSize: '0.7rem',
                      height: 20
                    }}
                  />
                )}
              </Typography>
              {(searchTerm || productCodeFilter || categoryFilter !== 'all') && (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => {
                    setSearchTerm('');
                    setProductCodeFilter('');
                    setCategoryFilter('all');
                    setPage(0);
                  }}
                  sx={{ ml: 1 }}
                >
                  Clear Filters
                </Button>
              )}
            </Box>
          </Box>
        </CardContent>
      </Card>

      {/* Main Products Table */}
      <Card sx={{
        mb: 3,
        backgroundColor: 'background.paper',
        border: '1px solid',
        borderColor: 'grey.100'
      }}>
        <CardContent sx={{ p: 2 }}>
          {error && (
            <Alert 
              severity="error" 
              sx={{
                mb: 3,
                borderRadius: 2,
                '& .MuiAlert-icon': { color: 'error.main' }
              }}
              icon={<ErrorIcon />}
            >
              {error}
            </Alert>
          )}

          <TableContainer
            component={Paper} 
            sx={{
              mb: 2,
              borderRadius: 2,
              border: '1px solid',
              borderColor: 'grey.100',
              overflow: 'hidden'
            }}
          >
            <Table size="medium">
              <TableHead>
                <TableRow sx={{
                  backgroundColor: 'grey.100'
                }}>
                  <TableCell sx={{ 
                    fontWeight: 500, 
                    color: 'text.primary', 
                    fontSize: '0.875rem',
                    borderBottom: '1px solid',
                    borderBottomColor: 'grey.100'
                  }}>
                    Client Code
                  </TableCell>
                  <TableCell sx={{ 
                    fontWeight: 500, 
                    color: 'text.primary', 
                    fontSize: '0.875rem',
                    borderBottom: '1px solid',
                    borderBottomColor: 'grey.100'
                  }}>
                    Product Code
                  </TableCell>
                  <TableCell sx={{ 
                    fontWeight: 500, 
                    color: 'text.primary', 
                    fontSize: '0.875rem',
                    borderBottom: '1px solid',
                    borderBottomColor: 'grey.100'
                  }}>
                    Product Name
                  </TableCell>
                  <TableCell sx={{ 
                    fontWeight: 500, 
                    color: 'text.primary', 
                    fontSize: '0.875rem',
                    borderBottom: '1px solid',
                    borderBottomColor: 'grey.100'
                  }}>
                    Description
                  </TableCell>
                   <TableCell sx={{ 
                     fontWeight: 500, 
                     color: 'text.primary', 
                     fontSize: '0.875rem',
                     borderBottom: '1px solid',
                     borderBottomColor: 'grey.100'
                   }}>
                     Cable Info
                   </TableCell>
                   <TableCell sx={{ 
                     fontWeight: 500, 
                     color: 'text.primary', 
                     fontSize: '0.875rem',
                     borderBottom: '1px solid',
                     borderBottomColor: 'grey.100'
                   }}>
                     Moulding
                   </TableCell>
                  <TableCell sx={{ 
                    fontWeight: 500, 
                    color: 'text.primary', 
                    fontSize: '0.875rem',
                    borderBottom: '1px solid',
                    borderBottomColor: 'grey.100'
                  }}>
                    Actions
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {paginatedProducts.length === 0 ? (
                  <TableRow>
                     <TableCell colSpan={7} sx={{ textAlign: 'center', py: 4 }}>
                      <Typography variant="body2" color="text.secondary">
                        {searchTerm || productCodeFilter || categoryFilter !== 'all' 
                          ? 'No products match your search criteria' 
                          : 'No products found'}
                      </Typography>
                      {productCodeFilter && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                          Try adjusting your product code filter: "{productCodeFilter}"
                        </Typography>
                      )}
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedProducts.map((product) => (
                    <TableRow 
                      key={product.productCode}
                      sx={{ 
                        '&:hover': { 
                          backgroundColor: 'rgba(76, 175, 80, 0.03)',
                          transition: 'background-color 0.2s ease',
                          transform: 'scale(1.005)',
                          boxShadow: '0 1px 4px rgba(76, 175, 80, 0.05)'
                        },
                        '&:nth-of-type(even)': {
                          backgroundColor: 'rgba(76, 175, 80, 0.01)'
                        }
                      }}
                    >
                      <TableCell sx={{ fontWeight: 600, color: 'text.primary' }}>
                        <Chip
                          label={product.clientCode}
                          size="small"
                          sx={{
                            background: 'rgba(156, 39, 176, 0.1)',
                            color: 'secondary.main',
                            fontWeight: 600,
                            border: '1px solid rgba(156, 39, 176, 0.2)',
                            fontSize: '0.7rem'
                          }}
                        />
                      </TableCell>
                      <TableCell sx={{ fontWeight: 600, color: 'text.primary' }}>
                        <Chip
                          label={product.productCode}
                          size="small"
                          sx={{
                            background: 'rgba(25, 118, 210, 0.1)',
                            color: 'primary.main',
                            fontWeight: 600,
                            border: '1px solid rgba(25, 118, 210, 0.2)',
                            '&:hover': {
                              transform: 'scale(1.02)',
                              transition: 'transform 0.2s ease',
                              background: 'rgba(25, 118, 210, 0.15)'
                            }
                          }}
                        />
                      </TableCell>
                      <TableCell sx={{ fontWeight: 600, color: 'text.primary' }}>
                        {product.productName}
                      </TableCell>
                      <TableCell sx={{ color: 'text.secondary', maxWidth: 200 }}>
                        <Typography 
                          variant="body2" 
                          sx={{ 
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {product.description}
                        </Typography>
                      </TableCell>
                       <TableCell sx={{ color: 'text.secondary', maxWidth: 200 }}>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                          {product.numberOfCore && (
                            <Typography variant="caption" sx={{ fontSize: '0.7rem', fontWeight: 500 }}>
                              {product.numberOfCore} Core
                            </Typography>
                          )}
                          {product.coreColors && Array.isArray(product.coreColors) && product.coreColors.length > 0 && (
                            <Box sx={{ display: 'flex', gap: 0.25, flexWrap: 'wrap' }}>
                              {product.coreColors.slice(0, 2).map((color, index) => (
                                <Chip
                                  key={index}
                                  label={color}
                                  size="small"
                                  sx={{
                                    fontSize: '0.6rem',
                                    height: 16,
                                    backgroundColor: 'info.lighter',
                                    color: 'primary.main',
                                    border: '1px solid rgba(25, 118, 210, 0.2)'
                                  }}
                                />
                              ))}
                              {product.coreColors.length > 2 && (
                                <Typography variant="caption" sx={{ fontSize: '0.6rem', color: 'text.secondary' }}>
                                  +{product.coreColors.length - 2} more
                                </Typography>
                              )}
                            </Box>
                          )}
                          {product.totalLength && (
                            <Typography variant="caption" sx={{ fontSize: '0.7rem', color: 'text.secondary' }}>
                              {product.totalLength}
                            </Typography>
                          )}
                        </Box>
                      </TableCell>
                      <TableCell sx={{ color: 'text.secondary', maxWidth: 200 }}>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                          {product.typeOfProduct && (
                            <Typography variant="caption" sx={{ fontSize: '0.7rem', fontWeight: 500 }}>
                              {product.typeOfProduct}
                            </Typography>
                          )}
                          {product.typeOfMould && (
                            <Typography variant="caption" sx={{ fontSize: '0.7rem', color: 'text.secondary' }}>
                              {product.typeOfMould}
                            </Typography>
                          )}
                          {product.pinType && (
                            <Typography variant="caption" sx={{ fontSize: '0.7rem', color: 'text.secondary' }}>
                              {product.pinType}
                            </Typography>
                          )}
                          {product.grommetPresent && (
                            <Chip
                              label="Grommet"
                              size="small"
                              sx={{
                                fontSize: '0.6rem',
                                height: 16,
                                backgroundColor: 'warning.lighter',
                                color: 'warning.main',
                                border: '1px solid rgba(230, 81, 0, 0.2)'
                              }}
                            />
                          )}
                        </Box>
                       </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                          <Tooltip title="View Details">
                            <IconButton 
                              onClick={() => handleViewDetails(product)}
                              sx={{ 
                                color: 'info.main',
                                '&:hover': { 
                                  backgroundColor: 'rgba(0, 188, 212, 0.1)',
                                  transform: 'scale(1.1)',
                                  transition: 'all 0.2s ease'
                                }
                              }}
                            >
                              <Visibility fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Edit Product">
                            <IconButton 
                              onClick={() => handleEdit(product)}
                              sx={{ 
                                color: 'primary.main',
                                '&:hover': { 
                                  backgroundColor: 'rgba(25, 118, 210, 0.1)',
                                  transform: 'scale(1.1)',
                                  transition: 'all 0.2s ease'
                                }
                              }}
                            >
                              <Edit fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="View BOM">
                            <IconButton 
                              onClick={() => handleBOMNavigation(product)}
                              sx={{ 
                                color: 'success.main',
                                '&:hover': { 
                                  backgroundColor: 'rgba(76, 175, 80, 0.1)',
                                  transform: 'scale(1.1)',
                                  transition: 'all 0.2s ease'
                                }
                              }}
                            >
                              <Assignment fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Delete Product">
                            <IconButton 
                              onClick={() => handleDelete(product.productCode)} 
                              sx={{ 
                                color: 'error.main',
                                '&:hover': { 
                                  backgroundColor: 'rgba(211, 47, 47, 0.1)',
                                  transform: 'scale(1.1)',
                                  transition: 'all 0.2s ease'
                                }
                              }}
                            >
                              <Delete fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            
            {/* Pagination Controls */}
            {filteredProducts.length > 0 && (
              <Box sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                p: 2,
                borderTop: '1px solid',
                borderTopColor: 'grey.100',
                backgroundColor: 'grey.100'
              }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 500 }}>
                    Rows per page:
                  </Typography>
                  <FormControl size="small" sx={{ minWidth: 80 }}>
                    <Select
                      value={rowsPerPage}
                      onChange={(e) => {
                        setRowsPerPage(e.target.value);
                        setPage(0);
                      }}
                      sx={{
                        '& .MuiOutlinedInput-notchedOutline': {
                          borderColor: 'rgba(102, 126, 234, 0.3)',
                        },
                        '&:hover .MuiOutlinedInput-notchedOutline': {
                          borderColor: 'rgba(102, 126, 234, 0.5)',
                        },
                        '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                          borderColor: 'primary.dark',
                        }
                      }}
                    >
                      <MenuItem value={5}>5</MenuItem>
                      <MenuItem value={10}>10</MenuItem>
                      <MenuItem value={25}>25</MenuItem>
                      <MenuItem value={50}>50</MenuItem>
                      <MenuItem value={100}>100</MenuItem>
                    </Select>
                  </FormControl>
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                  <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 500 }}>
                    {page * rowsPerPage + 1}-{Math.min((page + 1) * rowsPerPage, filteredProducts.length)} of {filteredProducts.length} products
                  </Typography>
                  
                  {Math.ceil(filteredProducts.length / rowsPerPage) > 1 && (
                    <Pagination
                      count={Math.ceil(filteredProducts.length / rowsPerPage)}
                      page={page + 1}
                      onChange={(event, value) => setPage(value - 1)}
                      color="primary"
                      size="large"
                      showFirstButton
                      showLastButton
                      sx={(theme) => ({
                        '& .MuiPaginationItem-root': {
                          borderRadius: 3,
                          fontWeight: 700,
                          fontSize: '0.9rem',
                          minWidth: 36,
                          height: 36,
                          margin: '0 2px',
                          transition: 'all 0.3s ease',
                          '&:hover': {
                            transform: 'scale(1.1)',
                            boxShadow: '0 5px 15px rgba(0,0,0,0.2)'
                          },
                          '&.Mui-selected': {
                            background: `linear-gradient(135deg, ${theme.palette.primary.dark} 0%, ${theme.palette.primary.main} 100%)`,
                            color: theme.palette.common.white,
                            fontWeight: 800,
                            boxShadow: '0 8px 20px rgba(0,0,0,0.3)',
                            '&:hover': {
                              transform: 'scale(1.15)',
                              boxShadow: '0 10px 25px rgba(0,0,0,0.4)'
                            }
                          }
                        }
                      })}
                    />
                  )}
                </Box>
              </Box>
            )}
          </TableContainer>
        </CardContent>
      </Card>

      {/* Product Form Dialog */}
      <Dialog
        open={isFormOpen}
        onClose={handleFormClose}
        maxWidth="lg"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 2,
            border: '1px solid',
            borderColor: 'grey.100',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
          }
        }}
      >
        <DialogTitle sx={{
          color: 'text.primary',
          fontWeight: 500,
          backgroundColor: 'grey.100',
          borderBottom: '1px solid',
          borderBottomColor: 'grey.100'
        }}>
          {selectedProduct ? 'Edit Product' : 'Add New Product'}
        </DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          <ProductForm product={selectedProduct} onClose={handleFormClose} />
        </DialogContent>
      </Dialog>

      {/* Document Viewer Dialog */}
      <Dialog
        open={isViewerOpen}
        onClose={() => setIsViewerOpen(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 2,
            border: '1px solid',
            borderColor: 'grey.100',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
          }
        }}
      >
        <DialogTitle sx={{
          color: 'text.primary',
          fontWeight: 500,
          backgroundColor: 'grey.100',
          borderBottom: '1px solid',
          borderBottomColor: 'grey.100'
        }}>
          {selectedFile?.name}
        </DialogTitle>
        <DialogContent>
          {selectedFile && (
            <DocumentViewer fileId={selectedFile.id} fileName={selectedFile.name} />
          )}
        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
          <Button 
            onClick={() => setIsViewerOpen(false)}
            variant="outlined"
            sx={{
              borderColor: 'primary.main',
              color: 'primary.main',
              '&:hover': {
                borderColor: 'primary.dark',
                backgroundColor: 'rgba(25, 118, 210, 0.05)'
              }
            }}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>

      {/* Product Details Dialog */}
      <Dialog
        open={isDetailsOpen}
        onClose={() => setIsDetailsOpen(false)}
        maxWidth="lg"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 2,
            maxHeight: '90vh',
            overflow: 'hidden'
          }
        }}
      >
        <DialogTitle sx={{
          color: 'text.primary',
          fontWeight: 500,
          backgroundColor: 'grey.100',
          borderBottom: '1px solid',
          borderBottomColor: 'grey.100',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 600, color: 'text.primary' }}>
              Product Details
            </Typography>
            <Typography variant="subtitle1" sx={{ color: 'text.secondary', mt: 0.5 }}>
              {selectedProduct?.productCode} - {selectedProduct?.productName}
            </Typography>
          </Box>
          <Button
            onClick={() => setIsDetailsOpen(false)}
            sx={{
              color: 'text.secondary',
              '&:hover': { backgroundColor: 'rgba(108, 117, 125, 0.1)' }
            }}
          >
            ✕
          </Button>
        </DialogTitle>
        <DialogContent sx={{ p: 0, overflow: 'auto', maxHeight: 'calc(90vh - 120px)' }}>
          {selectedProduct && (
            <Box sx={{ p: 3 }}>
              {/* Debug: Show all sections are rendering */}
              <Box sx={{ mb: 2, p: 2, backgroundColor: 'info.lighter', borderRadius: 1, border: '2px solid', borderColor: 'primary.main' }}>
                <Typography variant="h6" sx={{ fontWeight: 600, color: 'primary.main' }}>
                  🔍 DEBUG: All sections should be visible below
                </Typography>
                <Typography variant="body2" sx={{ color: 'primary.main' }}>
                  Product: {selectedProduct.productCode} | Total fields: {Object.keys(selectedProduct).length}
                </Typography>
              </Box>
              {/* Basic Information Section */}
              <Card sx={{ mb: 3, boxShadow: '0 2px 8px rgba(0,0,0,0.1)', borderRadius: 2 }}>
                <CardContent sx={{ p: 3 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 3, pb: 2, borderBottom: '2px solid', borderBottomColor: 'info.lighter' }}>
                    <Box sx={{
                      width: 40,
                      height: 40,
                      borderRadius: '50%',
                      backgroundColor: 'info.lighter',
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      mr: 2
                    }}>
                      <Inventory sx={{ fontSize: 20, color: 'primary.main' }} />
                    </Box>
                    <Typography variant="h5" sx={{ fontWeight: 600, color: 'primary.main' }}>
                      Basic Information (9 fields)
                    </Typography>
                  </Box>
                  
                  <Grid container spacing={3}>
                    <Grid item xs={12} sm={6} md={4}>
                      <Box sx={{ p: 2, backgroundColor: 'grey.100', borderRadius: 1, border: '1px solid', borderColor: 'grey.100' }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.primary', mb: 1 }}>Client Code</Typography>
                        <Typography variant="body1" sx={{ color: 'text.primary', fontWeight: 500 }}>
                          {selectedProduct.clientCode || 'Not specified'}
                        </Typography>
                      </Box>
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <Box sx={{ p: 2, backgroundColor: 'grey.100', borderRadius: 1, border: '1px solid', borderColor: 'grey.100' }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.primary', mb: 1 }}>Product Code</Typography>
                        <Typography variant="body1" sx={{ color: 'text.primary', fontWeight: 500 }}>
                          {selectedProduct.productCode || 'Not specified'}
                        </Typography>
                      </Box>
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <Box sx={{ p: 2, backgroundColor: 'grey.100', borderRadius: 1, border: '1px solid', borderColor: 'grey.100' }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.primary', mb: 1 }}>Product Name</Typography>
                        <Typography variant="body1" sx={{ color: 'text.primary', fontWeight: 500 }}>
                          {selectedProduct.productName || 'Not specified'}
                        </Typography>
                      </Box>
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <Box sx={{ p: 2, backgroundColor: 'grey.100', borderRadius: 1, border: '1px solid', borderColor: 'grey.100' }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.primary', mb: 1 }}>Manpower Required</Typography>
                        <Typography variant="body2" sx={{ color: 'text.primary', mb: 0.5 }}>
                          Assembly: {selectedProduct.assemblyLineManpower || 0} | Cable: {selectedProduct.cableCuttingManpower || 0}
                        </Typography>
                        <Typography variant="body2" sx={{ color: 'text.primary', mb: 0.5 }}>
                          Molding: {selectedProduct.moldingMachineManpower || 0} | Packing: {selectedProduct.packingLineManpower || 0}
                        </Typography>
                        <Typography variant="body1" sx={{ color: 'primary.main', fontWeight: 600 }}>
                          Total: {parseInt(selectedProduct.assemblyLineManpower || 0) + parseInt(selectedProduct.cableCuttingManpower || 0) + parseInt(selectedProduct.moldingMachineManpower || 0) + parseInt(selectedProduct.packingLineManpower || 0)}
                        </Typography>
                      </Box>
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <Box sx={{ p: 2, backgroundColor: 'grey.100', borderRadius: 1, border: '1px solid', borderColor: 'grey.100' }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.primary', mb: 1 }}>Category</Typography>
                        <Typography variant="body1" sx={{ color: 'text.primary', fontWeight: 500 }}>
                          {selectedProduct.category || 'Not specified'}
                        </Typography>
                      </Box>
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <Box sx={{ p: 2, backgroundColor: 'grey.100', borderRadius: 1, border: '1px solid', borderColor: 'grey.100' }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.primary', mb: 1 }}>Total Length</Typography>
                        <Typography variant="body1" sx={{ color: 'text.primary', fontWeight: 500 }}>
                          {selectedProduct.totalLength || 'Not specified'}
                        </Typography>
                      </Box>
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <Box sx={{ p: 2, backgroundColor: 'grey.100', borderRadius: 1, border: '1px solid', borderColor: 'grey.100' }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.primary', mb: 1 }}>Colour</Typography>
                        <Typography variant="body1" sx={{ color: 'text.primary', fontWeight: 500 }}>
                          {selectedProduct.colour || 'Not specified'}
                        </Typography>
                      </Box>
                    </Grid>
                    <Grid item xs={12}>
                      <Box sx={{ p: 2, backgroundColor: 'grey.100', borderRadius: 1, border: '1px solid', borderColor: 'grey.100' }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.primary', mb: 1 }}>Description</Typography>
                        <Typography variant="body1" sx={{ color: 'text.primary', fontWeight: 500 }}>
                          {selectedProduct.description || 'No description provided'}
                        </Typography>
                      </Box>
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>

              {/* Cable Information Section */}
              <Card sx={{ mb: 3, boxShadow: '0 2px 8px rgba(0,0,0,0.1)', borderRadius: 2 }}>
                <CardContent sx={{ p: 3 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 3, pb: 2, borderBottom: '2px solid', borderBottomColor: 'success.lighter' }}>
                    <Box sx={{
                      width: 40,
                      height: 40,
                      borderRadius: '50%',
                      backgroundColor: 'success.lighter',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      mr: 2
                    }}>
                      <Description sx={{ fontSize: 20, color: 'success.main' }} />
                    </Box>
                    <Typography variant="h5" sx={{ fontWeight: 600, color: 'success.main' }}>
                      Cable Information (10 fields)
                    </Typography>
                  </Box>
                  
                  <Grid container spacing={3}>
                    <Grid item xs={12} sm={6} md={4}>
                      <Box sx={{ p: 2, backgroundColor: 'grey.100', borderRadius: 1, border: '1px solid', borderColor: 'grey.100' }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.primary', mb: 1 }}>Copper Gauge</Typography>
                        <Typography variant="body1" sx={{ color: 'text.primary', fontWeight: 500 }}>
                          {selectedProduct.copperStrands || 'Not specified'}
                        </Typography>
                      </Box>
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <Box sx={{ p: 2, backgroundColor: 'grey.100', borderRadius: 1, border: '1px solid', borderColor: 'grey.100' }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.primary', mb: 1 }}>Number of Strands</Typography>
                        <Typography variant="body1" sx={{ color: 'text.primary', fontWeight: 500 }}>
                          {selectedProduct.numberOfStrands || 'Not specified'}
                        </Typography>
                      </Box>
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <Box sx={{ p: 2, backgroundColor: 'grey.100', borderRadius: 1, border: '1px solid', borderColor: 'grey.100' }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.primary', mb: 1 }}>Number of Core</Typography>
                        <Typography variant="body1" sx={{ color: 'text.primary', fontWeight: 500 }}>
                          {selectedProduct.numberOfCore || 'Not specified'}
                        </Typography>
                      </Box>
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <Box sx={{ p: 2, backgroundColor: 'grey.100', borderRadius: 1, border: '1px solid', borderColor: 'grey.100' }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.primary', mb: 1 }}>Core OD</Typography>
                        <Typography variant="body1" sx={{ color: 'text.primary', fontWeight: 500 }}>
                          {selectedProduct.coreOD || 'Not specified'}
                        </Typography>
                      </Box>
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <Box sx={{ p: 2, backgroundColor: 'grey.100', borderRadius: 1, border: '1px solid', borderColor: 'grey.100' }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.primary', mb: 1 }}>Core PVC</Typography>
                        <Typography variant="body1" sx={{ color: 'text.primary', fontWeight: 500 }}>
                          {selectedProduct.corePVC || 'Not specified'}
                        </Typography>
                      </Box>
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <Box sx={{ p: 2, backgroundColor: 'grey.100', borderRadius: 1, border: '1px solid', borderColor: 'grey.100' }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.primary', mb: 1 }}>Sheath OD</Typography>
                        <Typography variant="body1" sx={{ color: 'text.primary', fontWeight: 500 }}>
                          {selectedProduct.sheathOD || 'Not specified'}
                        </Typography>
                      </Box>
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <Box sx={{ p: 2, backgroundColor: 'grey.100', borderRadius: 1, border: '1px solid', borderColor: 'grey.100' }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.primary', mb: 1 }}>Sheath Inner PVC</Typography>
                        <Typography variant="body1" sx={{ color: 'text.primary', fontWeight: 500 }}>
                          {selectedProduct.sheathInnerPVC || 'Not specified'}
                        </Typography>
                      </Box>
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <Box sx={{ p: 2, backgroundColor: 'grey.100', borderRadius: 1, border: '1px solid', borderColor: 'grey.100' }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.primary', mb: 1 }}>Sheath Outer PVC</Typography>
                        <Typography variant="body1" sx={{ color: 'text.primary', fontWeight: 500 }}>
                          {selectedProduct.sheathOuterPVC || 'Not specified'}
                        </Typography>
                      </Box>
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <Box sx={{ p: 2, backgroundColor: 'grey.100', borderRadius: 1, border: '1px solid', borderColor: 'grey.100' }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.primary', mb: 1 }}>Printing Material</Typography>
                        <Typography variant="body1" sx={{ color: 'text.primary', fontWeight: 500 }}>
                          {selectedProduct.printingMaterial || 'Not specified'}
                        </Typography>
                      </Box>
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <Box sx={{ p: 2, backgroundColor: 'grey.100', borderRadius: 1, border: '1px solid', borderColor: 'grey.100' }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.primary', mb: 1 }}>Core Colors</Typography>
                        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
                          {selectedProduct.coreColors && Array.isArray(selectedProduct.coreColors) && selectedProduct.coreColors.length > 0 ? (
                            selectedProduct.coreColors.map((color, index) => (
                              <Chip
                                key={index}
                                label={color}
                                size="small"
                                sx={{
                                  backgroundColor: 'info.lighter',
                                  color: 'primary.main',
                                  border: '1px solid rgba(25, 118, 210, 0.2)',
                                  fontSize: '0.75rem'
                                }}
                              />
                            ))
                          ) : (
                            <Typography variant="body2" sx={{ color: 'text.secondary', fontStyle: 'italic' }}>No colors specified</Typography>
                          )}
                        </Box>
                      </Box>
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>

              {/* Moulding Information Section */}
              <Card sx={{ mb: 3, boxShadow: '0 2px 8px rgba(0,0,0,0.1)', borderRadius: 2 }}>
                <CardContent sx={{ p: 3 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 3, pb: 2, borderBottom: '2px solid', borderBottomColor: 'warning.lighter' }}>
                    <Box sx={{
                      width: 40,
                      height: 40,
                      borderRadius: '50%',
                      backgroundColor: 'warning.lighter',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      mr: 2
                    }}>
                      <Add sx={{ fontSize: 20, color: 'warning.main' }} />
                    </Box>
                    <Typography variant="h5" sx={{ fontWeight: 600, color: 'warning.main' }}>
                      Moulding Information (10 fields)
                    </Typography>
                  </Box>
                  
                  {/* Side A */}
                  <Box sx={{ mb: 4 }}>
                    <Typography variant="h6" sx={{ mb: 3, fontWeight: 600, color: 'warning.main', display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: 'warning.main', mr: 1 }}></Box>
                      Side A
                    </Typography>
                    <Grid container spacing={3}>
                      <Grid item xs={12} sm={6} md={4}>
                        <Box sx={{ p: 2, backgroundColor: 'grey.100', borderRadius: 1, border: '1px solid', borderColor: 'grey.100' }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.primary', mb: 1 }}>Type of Product</Typography>
                          <Typography variant="body1" sx={{ color: 'text.primary', fontWeight: 500 }}>
                            {selectedProduct.typeOfProduct || 'Not specified'}
                          </Typography>
                        </Box>
                      </Grid>
                      <Grid item xs={12} sm={6} md={4}>
                        <Box sx={{ p: 2, backgroundColor: 'grey.100', borderRadius: 1, border: '1px solid', borderColor: 'grey.100' }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.primary', mb: 1 }}>Type of Mould</Typography>
                          <Typography variant="body1" sx={{ color: 'text.primary', fontWeight: 500 }}>
                            {selectedProduct.typeOfMould || 'Not specified'}
                          </Typography>
                        </Box>
                      </Grid>
                      <Grid item xs={12} sm={6} md={4}>
                        <Box sx={{ p: 2, backgroundColor: 'grey.100', borderRadius: 1, border: '1px solid', borderColor: 'grey.100' }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.primary', mb: 1 }}>Pin Type</Typography>
                          <Typography variant="body1" sx={{ color: 'text.primary', fontWeight: 500 }}>
                            {selectedProduct.pinType || 'Not specified'}
                          </Typography>
                        </Box>
                      </Grid>
                    </Grid>
                  </Box>

                  {/* Side B */}
                  <Box>
                    <Typography variant="h6" sx={{ mb: 3, fontWeight: 600, color: 'warning.main', display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: 'warning.main', mr: 1 }}></Box>
                      Side B
                    </Typography>
                    <Grid container spacing={3}>
                      <Grid item xs={12} sm={6} md={4}>
                        <Box sx={{ p: 2, backgroundColor: 'grey.100', borderRadius: 1, border: '1px solid', borderColor: 'grey.100' }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.primary', mb: 1 }}>Sheath Length</Typography>
                          <Typography variant="body1" sx={{ color: 'text.primary', fontWeight: 500 }}>
                            {selectedProduct.sheathLength || 'Not specified'}
                          </Typography>
                        </Box>
                      </Grid>
                      <Grid item xs={12} sm={6} md={4}>
                        <Box sx={{ p: 2, backgroundColor: 'grey.100', borderRadius: 1, border: '1px solid', borderColor: 'grey.100' }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.primary', mb: 1 }}>Strip Length</Typography>
                          <Typography variant="body1" sx={{ color: 'text.primary', fontWeight: 500 }}>
                            {selectedProduct.stripLength || 'Not specified'}
                          </Typography>
                        </Box>
                      </Grid>
                      <Grid item xs={12} sm={6} md={4}>
                        <Box sx={{ p: 2, backgroundColor: 'grey.100', borderRadius: 1, border: '1px solid', borderColor: 'grey.100' }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.primary', mb: 1 }}>Core-Red</Typography>
                          <Typography variant="body1" sx={{ color: 'text.primary', fontWeight: 500 }}>
                            {selectedProduct.coreRed || 'Not specified'}
                          </Typography>
                        </Box>
                      </Grid>
                      <Grid item xs={12} sm={6} md={4}>
                        <Box sx={{ p: 2, backgroundColor: 'grey.100', borderRadius: 1, border: '1px solid', borderColor: 'grey.100' }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.primary', mb: 1 }}>Sleeve</Typography>
                          <Typography variant="body1" sx={{ color: 'text.primary', fontWeight: 500 }}>
                            {selectedProduct.sleeve || 'Not specified'}
                          </Typography>
                        </Box>
                      </Grid>
                      <Grid item xs={12} sm={6} md={4}>
                        <Box sx={{ p: 2, backgroundColor: 'grey.100', borderRadius: 1, border: '1px solid', borderColor: 'grey.100' }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.primary', mb: 1 }}>Terminals</Typography>
                          <Typography variant="body1" sx={{ color: 'text.primary', fontWeight: 500 }}>
                            {selectedProduct.terminals || 'Not specified'}
                          </Typography>
                        </Box>
                      </Grid>
                      <Grid item xs={12} sm={6} md={4}>
                        <Box sx={{ p: 2, backgroundColor: 'grey.100', borderRadius: 1, border: '1px solid', borderColor: 'grey.100' }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.primary', mb: 1 }}>Grommet Present</Typography>
                          <Chip
                            label={selectedProduct.grommetPresent ? 'Yes' : 'No'}
                            size="small"
                            sx={{
                              backgroundColor: selectedProduct.grommetPresent ? 'success.lighter' : 'error.lighter',
                              color: selectedProduct.grommetPresent ? 'success.main' : 'error.main',
                              border: selectedProduct.grommetPresent ? '1px solid rgba(46, 125, 50, 0.2)' : '1px solid rgba(198, 40, 40, 0.2)',
                              fontSize: '0.75rem',
                              fontWeight: 500
                            }}
                          />
                        </Box>
                      </Grid>
                      <Grid item xs={12} sm={6} md={4}>
                        <Box sx={{ p: 2, backgroundColor: 'grey.100', borderRadius: 1, border: '1px solid', borderColor: 'grey.100' }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.primary', mb: 1 }}>Grommet Length from Side B</Typography>
                          <Typography variant="body1" sx={{ color: 'text.primary', fontWeight: 500 }}>
                            {selectedProduct.grommetLengthFromSideB || 'Not specified'}
                          </Typography>
                        </Box>
                      </Grid>
                    </Grid>
                  </Box>
                </CardContent>
              </Card>

              {/* Document Attachments Section */}
              <Card sx={{ mb: 3, boxShadow: '0 2px 8px rgba(0,0,0,0.1)', borderRadius: 2 }}>
                <CardContent sx={{ p: 3 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 3, pb: 2, borderBottom: '2px solid', borderBottomColor: 'primary.light' }}>
                    <Box sx={{
                      width: 40,
                      height: 40,
                      borderRadius: '50%',
                      backgroundColor: 'primary.light',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      mr: 2
                    }}>
                      <Description sx={{ fontSize: 20, color: 'primary.main' }} />
                    </Box>
                    <Typography variant="h5" sx={{ fontWeight: 600, color: 'primary.main' }}>
                      Document Attachments (8 fields)
                    </Typography>
                  </Box>
                  
                  <Grid container spacing={3}>
                    {[
                      { field: 'drawing', label: 'Drawing', color: theme.palette.primary.main, icon: '📄' },
                      { field: 'fpa', label: 'FPA', color: theme.palette.primary.main, icon: '📋' },
                      { field: 'pdi', label: 'PDI', color: theme.palette.success.main, icon: '✅' },
                      { field: 'processChecksheet', label: 'Process Checksheet', color: theme.palette.warning.main, icon: '📝' },
                      { field: 'packagingStandard', label: 'Packaging Standard', color: theme.palette.error.main, icon: '📦' },
                      { field: 'bom', label: 'BOM', color: theme.palette.primary.main, icon: '📊' },
                      { field: 'sop', label: 'SOP', color: theme.palette.text.primary, icon: '📖' },
                      { field: 'pfc', label: 'PFC', color: theme.palette.text.primary, icon: '🔧' }
                    ].map(({ field, label, color, icon }) => (
                      <Grid item xs={12} sm={6} md={3} key={field}>
                        <Box sx={{ 
                          p: 3, 
                          border: `2px solid ${selectedProduct[field] ? color : theme.palette.grey[100]}`,
                          borderRadius: 2,
                          backgroundColor: selectedProduct[field] ? 'grey.100' : 'grey.100',
                          textAlign: 'center',
                          transition: 'all 0.3s ease',
                          '&:hover': {
                            transform: 'translateY(-2px)',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                          }
                        }}>
                          <Typography variant="h6" sx={{ mb: 1, fontSize: '1.5rem' }}>
                            {icon}
                          </Typography>
                          <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'text.primary', mb: 2 }}>
                            {label}
                          </Typography>
                          {selectedProduct[field] ? (
                            <Button
                              variant="contained"
                              size="small"
                              onClick={() => handleViewFile(selectedProduct[field], label)}
                              sx={{
                                backgroundColor: color,
                                color: 'common.white',
                                fontWeight: 500,
                                '&:hover': {
                                  backgroundColor: color,
                                  opacity: 0.9
                                }
                              }}
                            >
                              View File
                            </Button>
                          ) : (
                            <Typography variant="body2" sx={{ color: 'text.secondary', fontStyle: 'italic' }}>
                              No file attached
                            </Typography>
                          )}
                        </Box>
                      </Grid>
                    ))}
                  </Grid>
                </CardContent>
              </Card>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 3, borderTop: '1px solid', borderTopColor: 'grey.100' }}>
          <Button 
            onClick={() => setIsDetailsOpen(false)}
            variant="outlined"
            sx={{
              borderColor: 'primary.main',
              color: 'primary.main',
              '&:hover': {
                borderColor: 'primary.dark',
                backgroundColor: 'rgba(25, 118, 210, 0.05)'
              }
            }}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>

      {/* Success Snackbar */}
      <Snackbar
        open={success}
        autoHideDuration={4000}
        onClose={() => setSuccess(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert 
          severity="success" 
          sx={{ 
            width: "100%",
            borderRadius: 2,
            '& .MuiAlert-icon': { color: 'success.main' }
          }}
          icon={<CheckCircle />}
        >
          Product operation completed successfully!
        </Alert>
      </Snackbar>

      {/* Error Snackbar */}
      <Snackbar
        open={!!error}
        autoHideDuration={4000}
        onClose={() => setError(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert 
          severity="error" 
          sx={{
            width: "100%",
            borderRadius: 2,
            '& .MuiAlert-icon': { color: 'error.main' }
          }}
          icon={<ErrorIcon />}
        >
          {error}
        </Alert>
      </Snackbar>

      {/* Floating Action Button */}
      <Fab
        sx={{ 
          position: 'fixed', 
          bottom: 16, 
          right: 16,
          backgroundColor: 'primary.main',
          color: 'common.white',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          '&:hover': {
            backgroundColor: 'primary.dark',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
          }
        }}
        onClick={() => setIsFormOpen(true)}
      >
        <Add />
      </Fab>
    </Container>
  );
};

export default ProductList; 
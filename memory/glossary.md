# Glossary — Ceniza

Full decoder ring for all Ceniza app terms, fields, and internal language.

## Business Terms
| Term | Meaning |
|------|---------|
| pedido | Order — one row in the Google Sheet |
| pantalón | The product: women's pants, sold at $30 |
| talla | Size |
| ruedo | Hem length (customization) |
| carrito | Shopping cart — JS array of items for a new order |
| quincena | Bi-weekly pay period (twice a month) |
| comisión | Sales commission earned by a vendedora |
| utilidad neta | Net profit per unit: $13.29 (precio $30 − costo $16.71) |
| fila | Row number in the Google Sheet (acts as order ID) |
| tipoEntrega | Delivery type: "envío" (ship) or "retiro" (pickup) |
| montoDelivery | Delivery fee amount |
| montoProducto | Product price amount |
| montoEfectivo | Cash received |
| vuelto | Change given back |
| metodoPago | Payment method |
| origen | Lead source (Instagram, referral, etc.) |
| notas | Notes on the order |
| estado | Order status: Pendiente, En costura, Listo, Entregado |
| responsable | Vendedora who created the order |
| fechaRegistro | Date order was registered |
| fechaEntrega | Expected delivery date |

## Roles
| Rol (localStorage) | PIN | UI Name | Access |
|--------------------|-----|---------|--------|
| vendedora | 2317 | Vendedora | Register & view own orders, see commissions |
| costurera | 5690 | Taller de costura | Production queue, change status |
| delivery | 5420 | Delivery | Delivery list, mark entregado |
| duena | 5439 | Administración | Full access |

## App State Variables
| Variable | Type | Meaning |
|----------|------|---------|
| `carrito` | Array | Items being added to a new order |
| `formModo` | String | `'nuevo'` or `'editar'` |
| `filaEdicion` | Number | Row being edited in edit mode |
| `pedidosMap` | Object | `fila → pedido` for O(1) lookup |
| `rolPendiente` | String | Role awaiting PIN confirmation |
| `MES_ACTIVO` | String | Active month, e.g. "Junio 2026" |

## API Actions (accion= parameter)
| accion | What it does |
|--------|-------------|
| dashboard | Get dashboard summary + commissions |
| produccion | Get all orders for production queue |
| entregas | Get orders for delivery (by date) |
| comisiones | Get commission detail for a vendedora |
| registrar | Register a single order (legacy) |
| registrarPedidos | Register multi-item order (current) |
| cambiarEstado | Update order status |
| editarPedido | Edit an existing order row |
| getClientes | Get autocomplete list of clients |

## CSS Custom Properties
| Var | Value | Usage |
|-----|-------|-------|
| `--gold` | `#b39c2f` | Primary brand gold |
| `--brand-cream` | `#f7ecb7` | Warm cream accent |
| `--gold-dim` | `#9a6f1a` | Darker gold for hover |
| `--gold-bg` | `rgba(179,156,47,0.12)` | Subtle gold background tint |

## Commission Tiers
| Pants sold | Pct | Notes |
|------------|-----|-------|
| 1–149 | 5% | Starts from pant 1 |
| 150–199 | 6% | |
| 200–299 | 7% | |
| 300–399 | 8% | |
| 400+ | 10% | |
- Formula: `comisión = pants × $13.29 × pct`
- Total pago: `$100 (base fija) + comisión`

## Google Sheet Columns (Pedidos sheet, 1-indexed)
| Col | Field |
|-----|-------|
| 1 | fechaRegistro |
| 2 | cliente |
| 3 | telefono |
| 4 | producto |
| 5 | color |
| 6 | ruedo |
| 7 | talla |
| 8 | tipoEntrega |
| 9 | direccion |
| 10 | montoProducto |
| 11 | montoDelivery |
| 12 | estado |
| 13 | fechaEntrega |
| 14 | (unused / timestamp) |
| 15 | responsable |
| 16 | origen |
| 17 | metodoPago |
| 18 | notas |
| 19 | cedula |
| 20 | montoEfectivo |
| 21 | vuelto |

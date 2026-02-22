
export type Role = 'super_admin' | 'power_admin' | 'project_manager' | 'supervisor' | 'it_specialist';

export interface Project {
  id: string;
  name: string;
  location: string;
  pmId?: string; // Link to Project Manager
  createdAt?: string;
}

export interface SiteSummary {
  projectId: string;
  siteName: string;
  location: string;
  supervisorCount: number;
  pendingRequestsCount: number;
  assetsMaintenanceCount: number;
}

export interface User {
  id: string;
  username: string;
  password?: string; // Optional for safety in frontend display
  name: string;
  role: Role;
  teamName?: string; // Only for supervisors
  projectId?: string; // Null for super_admin, required for others
  reportsTo?: string; // ID of the Project Manager this user reports to (for Supervisors)
}

export interface Operator {
  id: string; // CSV ID
  name: string;
  phone: string;
  supervisorId: string;
  projectId: string;
}

export interface KPILog {
  id: string;
  operatorId: string;
  supervisorId: string;
  projectId: string;
  date: string; // ISO Date string YYYY-MM-DD
  attitude: number;
  performance: number;
  quality: number;
  appearance: number;
  dailyVolume?: number; // Legacy/Optional now
  status?: 'pending' | 'approved' | 'rejected'; // New field for workflow
  timestamp: number;
}

export interface TeamStats {
  id?: string;
  supervisorId: string;
  projectId: string;
  date: string;
  volume: number;
}

export interface UnlockRequest {
  id: string;
  operatorId: string;
  operatorName: string; // Denormalized for easier display
  supervisorId: string;
  supervisorName: string;
  projectId: string;
  logId?: string; // Optional reference to the locked log
  date: string;
  status: 'pending' | 'approved' | 'rejected';
  reason?: string;
  createdAt: string;
}

export interface Asset {
  id: string;
  assetTag?: string; // New: Unique Tag (Barcode/QR)
  name: string;
  type: string; // Hardware Type
  // Updated status to include 'in_use' and 'in_storage'
  status: 'operational' | 'faulty' | 'maintenance' | 'retired' | 'in_use' | 'in_storage';

  // Specs
  serialNumber: string;
  macAddress?: string;
  cpu?: string;
  ram?: string;
  storage?: string;
  currentCounter?: number; // Added for Scanner type

  // Financials
  purchaseDate?: string;
  cost?: number;

  // Context
  projectId: string; // Project/Site
  physicalLocation?: string; // Specific location (e.g. Room 101)
  assignedUser?: string;
  department?: string;

  lastMaintenanceDate: string; // ISO Date
  imageUrl?: string;
  lastAuditDate?: string; // ISO Date of last verification
  auditedBy?: string; // User ID of who verified it
}

export interface MaintenanceRequest {
  id?: string;
  assetId: string;
  supervisorId: string;
  projectId: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  status: 'pending' | 'in_progress' | 'completed';
  createdAt: string;
}

export interface Ticket {
  id: string;
  title: string;
  category: 'hardware' | 'software' | 'network' | 'facility' | 'tools' | 'other';
  assetId?: string;
  assetName?: string; // For display
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'in_progress' | 'solved' | 'closed';
  createdBy: string; // Supervisor ID
  creatorName?: string;
  pmId: string; // Assigned PM
  projectId: string;
  projectName?: string;
  createdAt: string;
  solvedAt?: string;
  closedAt?: string;
  cost?: number;
}

export interface Session {
  user: User | null;
  isAuthenticated: boolean;
}

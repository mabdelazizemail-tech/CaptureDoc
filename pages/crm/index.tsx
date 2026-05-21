import React from 'react';
import { Routes, Route } from 'react-router-dom';
import CRMLayout from './CRMLayout';
import CRMDashboard from './CRMDashboard';
import CRMLeads from './CRMLeads';
import CRMAccounts from './CRMAccounts';
import CRMContacts from './CRMContacts';
import CRMDeals from './CRMDeals';
import CRMTasks from './CRMTasks';
import CRMRecordDetail from './CRMRecordDetail';
import { User } from '../../services/types';

interface CRMModuleProps {
  user: User;
  onLogout: () => void;
}

export default function CRMModule({ user, onLogout }: CRMModuleProps) {
  return (
    <Routes>
      <Route element={<CRMLayout user={user} onLogout={onLogout} />}>
        <Route path="/crm" element={<CRMDashboard user={user} />} />
        <Route path="/crm/leads" element={<CRMLeads user={user} />} />
        <Route path="/crm/accounts" element={<CRMAccounts user={user} />} />
        <Route path="/crm/contacts" element={<CRMContacts user={user} />} />
        <Route path="/crm/deals" element={<CRMDeals user={user} />} />
        <Route path="/crm/tasks" element={<CRMTasks user={user} />} />
        <Route path="/crm/detail/:type/:id" element={<CRMRecordDetail />} />
      </Route>
    </Routes>
  );
}


import React, { useEffect, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { getContacts, Contact } from '../services/crmService';

export default function Contacts() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchContacts() {
      const data = await getContacts();
      setContacts(data);
      setLoading(false);
    }
    fetchContacts();
  }, []);

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50/50">
        <h3 className="text-base font-medium text-gray-900">All Contacts</h3>
        <input 
          type="text" 
          placeholder="Search contacts..." 
          className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 w-64"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/50 text-xs font-medium text-gray-500 uppercase tracking-wider">
              <th className="px-6 py-3">Name</th>
              <th className="px-6 py-3">Company</th>
              <th className="px-6 py-3">Email</th>
              <th className="px-6 py-3">Phone</th>
              <th className="px-6 py-3 w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={5} className="px-6 py-8 text-center text-gray-500">Loading contacts...</td></tr>
            ) : contacts.length === 0 ? (
              <tr><td colSpan={5} className="px-6 py-8 text-center text-gray-500">No contacts found. Click "+ Quick Add" to create one.</td></tr>
            ) : (
              contacts.map((contact) => (
                <tr key={contact.id} className="hover:bg-gray-50 transition-colors group cursor-pointer">
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">{contact.first_name} {contact.last_name}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{contact.company?.name || '-'}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{contact.email || '-'}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{contact.phone || '-'}</td>
                  <td className="px-6 py-4 text-sm text-gray-400">
                    <button className="opacity-0 group-hover:opacity-100 hover:text-gray-900 transition-opacity">
                      <MoreHorizontal className="w-5 h-5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

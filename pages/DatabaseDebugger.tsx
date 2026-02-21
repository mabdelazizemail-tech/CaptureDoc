import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabaseClient';

const DatabaseDebugger: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [records, setRecords] = useState<any[]>([]);
  const [debugError, setDebugError] = useState<any>(null);

  const fetchAll = async () => {
    setLoading(true);
    setDebugError(null);
    setRecords([]);
    console.log("Debugger: Fetching all unlock_requests...");
    
    try {
        const { data, error } = await supabase.from('unlock_requests').select('*');
        if (error) {
            setDebugError(error);
        } else {
            setRecords(data || []);
        }
    } catch (err) {
        setDebugError({ message: 'Unexpected exception', details: err });
    } finally {
        setLoading(false);
    }
  };

  const testFilter = async () => {
    setLoading(true);
    setDebugError(null);
    setRecords([]);
    const testId = '2d605c62-a0e5-4722-927e-bd98d7a8d2c2';
    console.log(`Debugger: Testing filter for project_id=${testId}`);

    try {
        const { data, error } = await supabase
            .from('unlock_requests')
            .select('*')
            .eq('project_id', testId);
            
        if (error) {
            setDebugError(error);
        } else {
            setRecords(data || []);
        }
    } catch (err) {
        setDebugError({ message: 'Unexpected exception', details: err });
    } finally {
        setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6 ltr" style={{ direction: 'ltr' }}>
        <h1 className="text-3xl font-bold text-gray-800 flex items-center gap-2">
            <span className="material-icons text-red-600">pest_control</span>
            Database Debugger
        </h1>

        <div className="flex gap-4 flex-wrap">
            <button onClick={fetchAll} className="bg-gray-800 text-white px-4 py-2 rounded hover:bg-gray-900 transition-colors">
                Fetch All (*)
            </button>
            <button onClick={testFilter} className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors">
                Test Filter by Project ID
            </button>
        </div>

        {loading && (
            <div className="flex items-center gap-2 text-xl text-gray-500">
                <span className="material-icons animate-spin">donut_large</span>
                Loading from Supabase...
            </div>
        )}

        {debugError && (
            <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded shadow-sm">
                <p className="font-bold text-lg flex items-center gap-2">
                    <span className="material-icons">error</span> Error Occurred
                </p>
                <div className="mt-2 space-y-1 font-mono text-sm">
                    <p><strong>Message:</strong> {debugError.message}</p>
                    <p><strong>Code:</strong> {debugError.code || 'N/A'}</p>
                    <p><strong>Details:</strong> {debugError.details || JSON.stringify(debugError)}</p>
                </div>
            </div>
        )}

        {!loading && !debugError && records.length === 0 && (
            <div className="bg-yellow-50 border-l-4 border-yellow-500 p-4 text-yellow-800 rounded">
                <h3 className="font-bold text-lg mb-2 flex items-center gap-2">
                    <span className="material-icons">lightbulb</span> Diagnosis: No Records Found
                </h3>
                <p>The query returned 0 rows successfully.</p>
                <div className="mt-4 bg-white p-3 rounded border border-yellow-200">
                    <p className="font-bold text-yellow-900 mb-2">Checklist:</p>
                    <ul className="list-disc pl-5 space-y-1 text-sm">
                        <li><strong>RLS (Row Level Security):</strong> If error is null but records are 0, policies might be hiding data.</li>
                        <li><strong>Empty Table:</strong> Ensure `unlock_requests` actually has data in the Supabase dashboard.</li>
                        <li><strong>Auth Context:</strong> Are you logged in? Does the user have `SELECT` permissions?</li>
                        <li><strong>Filter:</strong> If using the filter button, does ID <code>2d605c62...</code> exist?</li>
                    </ul>
                </div>
            </div>
        )}

        {records.length > 0 && (
            <div className="space-y-6">
                <div className="bg-green-50 border border-green-200 p-4 rounded text-green-800 flex items-center gap-2">
                    <span className="material-icons">check_circle</span>
                    <strong>Success!</strong> Found {records.length} records.
                </div>
                
                <div className="bg-gray-100 p-4 rounded border border-gray-300 font-mono text-sm overflow-x-auto">
                    <h4 className="font-bold text-gray-700 border-b border-gray-300 pb-2 mb-2">Schema Detection (Keys of first record):</h4>
                    <div className="break-all text-blue-600 font-bold">
                        [{Object.keys(records[0]).join(', ')}]
                    </div>
                </div>

                <div className="overflow-x-auto bg-white shadow rounded-lg">
                    <table className="w-full text-left text-sm font-mono">
                        <thead className="bg-gray-800 text-white">
                            <tr>
                                {Object.keys(records[0]).map(key => (
                                    <th key={key} className="p-3 border-b border-gray-700 whitespace-nowrap">{key}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {records.map((rec, i) => (
                                <tr key={i} className="hover:bg-gray-50">
                                    {Object.values(rec).map((val: any, idx) => (
                                        <td key={idx} className="p-3 border-r whitespace-nowrap max-w-xs truncate" title={String(val)}>
                                            {typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val)}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        )}
    </div>
  );
};

export default DatabaseDebugger;
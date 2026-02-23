import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabaseClient';
import { StorageService } from '../services/storage';
import { User } from '../services/types';

interface HealthCheckProps {
    user: User | null;
}

const HealthCheck: React.FC<HealthCheckProps> = ({ user }) => {
    const [report, setReport] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [requests, setRequests] = useState<any[]>([]);

    // Project Context State
    const [targetProjectId, setTargetProjectId] = useState<string>(user?.projectId || '');
    const [nameSearchTerm, setNameSearchTerm] = useState('');
    const [foundProjects, setFoundProjects] = useState<any[]>([]);
    const [isSearching, setIsSearching] = useState(false);

    // Unlock Debugger State
    const [unlockDebugLog, setUnlockDebugLog] = useState<string[]>([]);
    const [isUnlockTesting, setIsUnlockTesting] = useState(false);

    useEffect(() => {
        if (user?.projectId) {
            setTargetProjectId(user.projectId);
        }
    }, [user]);

    // Search Projects by Name
    const searchProjectsByName = async () => {
        if (!nameSearchTerm.trim()) return;
        setIsSearching(true);
        try {
            const { data, error } = await supabase
                .from('projects')
                .select('id, name, location')
                .ilike('name', `%${nameSearchTerm}%`)
                .limit(5);

            if (error) {
                console.error('Error searching projects:', error);
            } else {
                setFoundProjects(data || []);
            }
        } catch (e) {
            console.error('Exception searching projects:', e);
        } finally {
            setIsSearching(false);
        }
    };

    // Select a project from search results
    const selectProject = (proj: any) => {
        setTargetProjectId(proj.id);
        setNameSearchTerm(proj.name); // Update input to show selected name
        setFoundProjects([]); // Clear results
        fetchUnlockRequests(proj.id);
    };

    const fetchUnlockRequests = async (pid: string = targetProjectId) => {
        if (!pid) return;

        try {
            const { data, error } = await supabase
                .from('unlock_requests')
                .select('*')
                .eq('project_id', pid)
                .order('created_at', { ascending: false })
                .limit(50);

            if (error) {
                console.error('Error fetching raw requests:', error);
                setRequests([]);
            } else {
                setRequests(data || []);
            }
        } catch (e) {
            console.error('Exception fetching raw requests:', e);
        }
    };

    const runDiagnostics = async () => {
        setLoading(true);

        // Fetch Data Dump if project ID is present
        await fetchUnlockRequests(targetProjectId);

        const timestamp = new Date().toISOString();
        const newReport: any = {
            timestamp,
            tables: {},
            rls: { status: 'Skipped', message: '' },
            hrAdmins: { status: 'Skipped', message: '', users: [] } // Initialize for new check
        };

        // 1. Connection & Schema Checks
        const tables = [
            {
                name: 'profiles',
                checkCols: ['id', 'username', 'role', 'project_id', 'email']
            },
            {
                name: 'projects',
                checkCols: ['id', 'name', 'location']
            },
            {
                name: 'operators',
                checkCols: ['id', 'name', 'supervisor_id', 'project_id']
            },
            {
                name: 'kpi_logs',
                checkCols: ['id', 'project_id', 'operator_id', 'attitude']
            },
            {
                name: 'unlock_requests',
                checkCols: ['id', 'logId', 'project_id', 'operator_id', 'status']
            },
            {
                name: 'assets',
                checkCols: [
                    'id', 'name', 'status', 'project_id',
                    'asset_tag', 'mac_address', 'cpu', 'ram', 'storage',
                    'purchase_date', 'cost', 'assigned_user', 'department', 'location'
                ]
            }
        ];

        for (const t of tables) {
            const tableRes: any = { connected: false, error: null, columns: {} };

            // Connection Test (Fetch 1 row)
            const { error } = await supabase.from(t.name).select('*').limit(1);

            if (error) {
                tableRes.error = error.message;
                tableRes.connected = false;
            } else {
                tableRes.connected = true;

                // Column Existence Check via Select
                for (const col of t.checkCols) {
                    const { error: colError } = await supabase.from(t.name).select(col).limit(1);
                    if (colError) {
                        tableRes.columns[col] = { exists: false, error: colError.message };
                    } else {
                        tableRes.columns[col] = { exists: true };
                    }
                }
            }
            newReport.tables[t.name] = tableRes;
        }

        // 1.5 Fetch HR Admins
        try {
            const { data: hrAdmins, error: hrErr } = await supabase.from('profiles').select('*').eq('role', 'hr_admin');
            if (hrErr) {
                newReport.hrAdmins = { status: 'Error', message: hrErr.message, users: [] };
            } else {
                newReport.hrAdmins = { status: 'Success', message: `Found ${hrAdmins?.length || 0} HR admins`, users: hrAdmins || [] };
            }
        } catch (e: any) {
            newReport.hrAdmins = { status: 'Exception', message: e.message, users: [] };
        }

        // 2. RLS / Insert Test (unlock_requests)
        // Use targetProjectId for the test
        if (user && targetProjectId) {
            try {
                const testId = `hc-${Date.now()}`;
                // We need valid foreign keys for a real insert if constraints exist.
                const { data: opData } = await supabase.from('operators').select('id').eq('project_id', targetProjectId).limit(1);
                const validOpId = opData && opData[0] ? opData[0].id : null;

                if (validOpId) {
                    const payload = {
                        id: testId,
                        operator_id: validOpId,
                        supervisor_id: user.id, // Assuming user.id maps to supervisor_id
                        project_id: targetProjectId,
                        date: new Date().toISOString().split('T')[0],
                        status: 'pending',
                        reason: 'Health Check Probe',
                        logId: null // Using the requested column name
                    };

                    const { error: insertError } = await supabase.from('unlock_requests').insert([payload]);

                    if (insertError) {
                        newReport.rls = { status: 'Failed', message: insertError.message };
                    } else {
                        // Cleanup
                        const { error: deleteError } = await supabase.from('unlock_requests').delete().eq('id', testId);
                        if (deleteError) {
                            newReport.rls = { status: 'Warning', message: 'Insert OK, Delete Failed: ' + deleteError.message };
                        } else {
                            newReport.rls = { status: 'Success', message: 'Insert and Delete successful' };
                        }
                    }
                } else {
                    newReport.rls = { status: 'Skipped', message: 'No valid operator found in this project to test FK constraints.' };
                }

            } catch (err: any) {
                newReport.rls = { status: 'Error', message: err.message };
            }
        } else {
            newReport.rls = { status: 'Skipped', message: 'No Target Project ID defined.' };
        }

        setReport(newReport);
        setLoading(false);
    };

    const runUnlockApprovalDiagnostics = async () => {
        setIsUnlockTesting(true);
        const logs: string[] = [];
        const addLog = (msg: string) => {
            logs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
            setUnlockDebugLog([...logs]); // React state update
        };

        // Helper to sleep for better visual pacing
        const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

        try {
            setUnlockDebugLog([]); // Clear previous logs
            addLog("🚀 Starting Approval Logic Diagnostic...");

            if (!targetProjectId) {
                throw new Error("No Target Project ID selected. Please select a project above.");
            }

            // 1. Find a valid operator
            addLog("🔍 Finding a valid operator in target project...");
            const { data: ops, error: opError } = await supabase
                .from('operators')
                .select('*')
                .eq('project_id', targetProjectId)
                .limit(1);

            if (opError || !ops || ops.length === 0) {
                throw new Error("No operators found in this project to test with.");
            }
            const testOp = ops[0];
            addLog(`✅ Found Operator: ${testOp.name} (${testOp.id})`);

            // Constants
            const testDate = new Date().toISOString().split('T')[0];
            const logId = `debug-log-${Date.now()}`;
            const reqId1 = `debug-req-1-${Date.now()}`;
            const reqId2 = `debug-req-2-${Date.now()}`; // The ghost duplicate

            // 2. Create a Dummy KPI Log
            await sleep(500);
            addLog("📝 Creating test KPI Log (Simulating Locked State)...");
            const { error: logInsertError } = await supabase.from('kpi_logs').insert([{
                id: logId,
                project_id: targetProjectId,
                operator_id: testOp.id,
                supervisor_id: user?.id,
                date: testDate,
                attitude: 5, performance: 5, quality: 5, appearance: 5,
                timestamp: Date.now()
            }]);

            if (logInsertError) throw new Error(`Failed to insert test log: ${logInsertError.message}`);
            addLog("✅ Test Log created.");

            // 3. Create Duplicate Unlock Requests (To test bulk fix)
            await sleep(500);
            addLog("👯 Creating DUPLICATE Unlock Requests (Simulating Ghost/Race Condition)...");
            const baseReq = {
                operator_id: testOp.id,
                operator_name: testOp.name,
                supervisor_id: user?.id,
                supervisor_name: user?.name || 'Debugger',
                project_id: targetProjectId,
                date: testDate,
                reason: 'Debug Diagnostic Test',
                status: 'pending'
            };

            const { error: req1Error } = await supabase.from('unlock_requests').insert([{ ...baseReq, id: reqId1 }]);
            const { error: req2Error } = await supabase.from('unlock_requests').insert([{ ...baseReq, id: reqId2 }]);

            if (req1Error || req2Error) throw new Error("Failed to insert test requests.");
            addLog(`✅ Created Request A (${reqId1}) and Request B (${reqId2}) - Both PENDING.`);

            // 4. Execute Approval Logic
            await sleep(1000);
            addLog("⚡ Executing StorageService.approveUnlockRequest(Request A)...");
            // This simulates what AdminDashboard does
            const success = await StorageService.approveUnlockRequest(reqId1, testOp.id, testDate, logId);

            if (success) {
                addLog("✅ Service returned TRUE (Success).");
            } else {
                addLog("❌ Service returned FALSE (Failed).");
            }

            // 5. Verification
            await sleep(500);
            addLog("🕵️ Verifying Database State...");

            // Check Log
            const { data: logCheck } = await supabase.from('kpi_logs').select('id').eq('id', logId).maybeSingle();
            if (!logCheck) {
                addLog("✅ KPI Log was successfully DELETED (Unlock worked).");
            } else {
                addLog("❌ FAILURE: KPI Log still exists!");
            }

            // Check Requests (The Ghost Fix Check)
            const { data: reqsCheck } = await supabase.from('unlock_requests').select('id, status').in('id', [reqId1, reqId2]);

            if (reqsCheck) {
                let approvedCount = 0;
                reqsCheck.forEach(r => {
                    const label = r.id === reqId1 ? "Request A (Target)" : "Request B (Ghost)";
                    if (r.status === 'approved') {
                        addLog(`✅ ${label}: Status is APPROVED.`);
                        approvedCount++;
                    } else {
                        addLog(`❌ ${label}: Status is '${r.status}' (Expected APPROVED).`);
                    }
                });

                if (approvedCount === 2) {
                    addLog("🏆 SUCCESS: Bulk Update Policy worked! Both requests approved.");
                } else {
                    addLog("⚠️ WARNING: Bulk Update did NOT catch all duplicates.");
                }
            }

            // 6. Cleanup
            await sleep(1000);
            addLog("🧹 Cleaning up test records...");
            await supabase.from('unlock_requests').delete().in('id', [reqId1, reqId2]);
            await supabase.from('kpi_logs').delete().eq('id', logId);

            addLog("🏁 Diagnostic Complete.");

        } catch (err: any) {
            addLog(`❌ CRITICAL ERROR: ${err.message}`);
            console.error(err);
        } finally {
            setIsUnlockTesting(false);
        }
    };

    useEffect(() => {
        runDiagnostics();
    }, [user]);

    const copyToClipboard = () => {
        navigator.clipboard.writeText(JSON.stringify(report, null, 2));
        alert('Debug info copied!');
    };

    return (
        <div className="p-8 max-w-6xl mx-auto space-y-8 ltr" style={{ direction: 'ltr' }}>
            <div className="flex justify-between items-center">
                <h1 className="text-3xl font-bold text-gray-800 flex items-center gap-3">
                    <span className="material-icons text-4xl text-primary">monitor_heart</span>
                    System Health Check
                </h1>
                <div className="flex gap-3">
                    <button
                        onClick={() => runDiagnostics()}
                        className="bg-blue-600 text-white px-4 py-2 rounded shadow hover:bg-blue-700 flex items-center gap-2"
                    >
                        <span className={`material-icons ${loading ? 'animate-spin' : ''}`}>refresh</span>
                        Run Diagnostics
                    </button>
                    <button
                        onClick={copyToClipboard}
                        className="bg-gray-800 text-white px-4 py-2 rounded shadow hover:bg-gray-900 flex items-center gap-2"
                    >
                        <span className="material-icons">content_copy</span>
                        Copy Report
                    </button>
                </div>
            </div>

            <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 text-sm text-blue-800">
                <strong className="block mb-1">Tip:</strong>
                If you see "column does not exist" errors, use the Supabase SQL Editor to reload the schema cache: <code className="bg-white px-1 rounded">NOTIFY pgrst, 'reload schema';</code>
            </div>

            {/* Target Project Selector */}
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                    <span className="material-icons text-gray-500">search</span>
                    Target Project Scope
                </h2>
                <div className="flex flex-col md:flex-row gap-4">
                    <div className="flex-1 relative">
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Find Project By Name</label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={nameSearchTerm}
                                onChange={(e) => setNameSearchTerm(e.target.value)}
                                placeholder="Type project name..."
                                className="flex-1 border p-2 rounded font-mono text-sm"
                                onKeyDown={(e) => e.key === 'Enter' && searchProjectsByName()}
                            />
                            <button
                                onClick={searchProjectsByName}
                                className="bg-gray-100 px-3 py-2 rounded hover:bg-gray-200 min-w-[80px]"
                                disabled={isSearching}
                            >
                                {isSearching ? '...' : 'Search'}
                            </button>
                        </div>
                        {foundProjects.length > 0 && (
                            <div className="absolute top-full left-0 right-0 bg-white shadow-xl border border-gray-200 rounded mt-1 z-10 max-h-48 overflow-y-auto">
                                {foundProjects.map(p => (
                                    <div
                                        key={p.id}
                                        onClick={() => selectProject(p)}
                                        className="p-2 hover:bg-blue-50 cursor-pointer border-b last:border-0"
                                    >
                                        <div className="font-bold text-sm text-gray-800">{p.name}</div>
                                        <div className="text-xs text-gray-500">{p.location} (ID: {p.id})</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="flex-1">
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Target Project ID (Manual)</label>
                        <input
                            type="text"
                            value={targetProjectId}
                            onChange={(e) => setTargetProjectId(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && fetchUnlockRequests(targetProjectId)}
                            placeholder="UUID (Enter to fetch)..."
                            className="w-full border p-2 rounded font-mono text-sm bg-gray-50"
                        />
                    </div>
                </div>
            </div>

            {/* Unlock Process Debugger */}
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <span className="material-icons text-purple-600">bug_report</span>
                        Unlock Process Debugger
                    </h2>
                    <button
                        onClick={runUnlockApprovalDiagnostics}
                        disabled={isUnlockTesting || !targetProjectId}
                        className={`px-4 py-2 rounded shadow font-bold flex items-center gap-2 ${isUnlockTesting || !targetProjectId
                            ? 'bg-gray-300 cursor-not-allowed text-gray-500'
                            : 'bg-purple-600 text-white hover:bg-purple-700'
                            }`}
                    >
                        {isUnlockTesting ? <span className="material-icons animate-spin">sync</span> : <span className="material-icons">play_arrow</span>}
                        Run Full Approval Test
                    </button>
                </div>
                <p className="text-sm text-gray-500 mb-4">
                    This tool simulates creating two duplicate "pending" requests and approving one of them.
                    It verifies if the system correctly "Bulk Approves" all duplicates and deletes the log.
                </p>

                <div className="bg-gray-900 text-green-400 p-4 rounded font-mono text-sm h-64 overflow-y-auto border border-gray-700 shadow-inner">
                    {unlockDebugLog.length === 0 ? (
                        <span className="text-gray-500 opacity-50 select-none">Ready to start diagnostics... waiting for input.</span>
                    ) : (
                        unlockDebugLog.map((line, i) => (
                            <div key={i} className="border-b border-gray-800 pb-1 mb-1 last:border-0">{line}</div>
                        ))
                    )}
                    {isUnlockTesting && <div className="animate-pulse mt-2">_ Processing...</div>}
                </div>
            </div>

            {/* Session Info */}
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                    <span className="material-icons text-gray-500">badge</span>
                    Session Context
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="p-3 bg-gray-50 rounded">
                        <span className="text-xs text-gray-500 block uppercase">User ID</span>
                        <span className="font-mono font-bold">{user?.id || 'Guest'}</span>
                    </div>
                    <div className="p-3 bg-gray-50 rounded">
                        <span className="text-xs text-gray-500 block uppercase">Role</span>
                        <span className="font-bold text-blue-600">{user?.role || '-'}</span>
                    </div>
                    <div className="p-3 bg-gray-50 rounded">
                        <span className="text-xs text-gray-500 block uppercase">Target Project ID</span>
                        <span className="font-mono text-sm">{targetProjectId || 'None Selected'}</span>
                    </div>
                    {report?.hrAdmins && (
                        <div className="p-3 bg-gray-50 rounded">
                            <span className="text-xs text-gray-500 block uppercase">HR Admin Check</span>
                            <span className={`font-bold ${report.hrAdmins.status === 'Success' ? 'text-green-600' : 'text-red-600'}`}>
                                {report.hrAdmins.status}: {report.hrAdmins.message}
                            </span>
                            {report.hrAdmins.users.length > 0 && (
                                <div className="mt-2 text-[10px] font-mono text-gray-600 bg-white p-2 border rounded max-h-32 overflow-y-auto">
                                    {report.hrAdmins.users.map((u: any) => (
                                        <div key={u.id} className="border-b last:border-0 pb-1 mb-1">
                                            {u.email} | {u.role} | ID: {u.id.slice(0, 8)}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                    <div className="p-3 bg-gray-50 rounded">
                        <span className="text-xs text-gray-500 block uppercase">RLS Test</span>
                        <span className={`font-bold ${report?.rls.status === 'Success' ? 'text-green-600' : report?.rls.status === 'Failed' ? 'text-red-600' : 'text-gray-600'}`}>
                            {report?.rls.status || 'Pending'}
                        </span>
                    </div>
                </div>
                {report?.rls.message && (
                    <div className="mt-2 text-xs text-gray-500">
                        RLS Message: {report.rls.message}
                    </div>
                )}
            </div>

            {/* Tables Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {report && Object.keys(report.tables).map((tableName) => {
                    const t = report.tables[tableName];
                    return (
                        <div key={tableName} className={`bg-white rounded-lg shadow-sm border-l-4 ${t.connected ? 'border-green-500' : 'border-red-500'} overflow-hidden`}>
                            <div className="p-4 border-b bg-gray-50 flex justify-between items-center">
                                <h3 className="font-bold text-lg font-mono">{tableName}</h3>
                                {t.connected ? (
                                    <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded font-bold">CONNECTED</span>
                                ) : (
                                    <span className="bg-red-100 text-red-800 text-xs px-2 py-1 rounded font-bold">ERROR</span>
                                )}
                            </div>
                            <div className="p-4">
                                {t.error && <div className="text-red-600 text-sm mb-4 bg-red-50 p-2 rounded">{t.error}</div>}

                                <div className="space-y-2">
                                    {Object.keys(t.columns).map(col => {
                                        const status = t.columns[col];
                                        return (
                                            <div key={col} className="flex justify-between items-center text-sm border-b border-gray-100 pb-1 last:border-0">
                                                <span className="font-mono text-gray-600">{col}</span>
                                                {status.exists ? (
                                                    <span className="text-green-600 flex items-center gap-1">
                                                        <span className="material-icons text-sm">check</span> Found
                                                    </span>
                                                ) : (
                                                    <span className="text-red-600 flex items-center gap-1 font-bold">
                                                        <span className="material-icons text-sm">warning</span> Missing
                                                    </span>
                                                )}
                                                {status.error && (
                                                    <span className="block text-xs text-red-400 w-full mt-1">
                                                        {status.error}
                                                    </span>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Raw Unlock Requests Data Table */}
            {targetProjectId && (
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden mt-8">
                    <div className="p-4 bg-gray-50 border-b flex justify-between items-center">
                        <h3 className="font-bold text-lg text-gray-800 flex items-center gap-2">
                            <span className="material-icons text-gray-500">dataset</span>
                            Raw Unlock Requests (Project: {targetProjectId})
                        </h3>
                        <span className="text-xs bg-gray-200 px-2 py-1 rounded text-gray-700 font-mono">
                            Count: {requests.length}
                        </span>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs font-mono">
                            <thead className="bg-gray-100 border-b">
                                <tr>
                                    <th className="p-3">ID</th>
                                    <th className="p-3">Operator</th>
                                    <th className="p-3">Supervisor</th>
                                    <th className="p-3">Status</th>
                                    <th className="p-3">Reason</th>
                                    <th className="p-3">Project ID</th>
                                    <th className="p-3">Created At</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {requests.length > 0 ? requests.map((req) => (
                                    <tr key={req.id} className="hover:bg-gray-50">
                                        <td className="p-3 text-gray-500">{req.id.slice(0, 8)}...</td>
                                        <td className="p-3 font-bold text-gray-700">{req.operator_name || 'N/A'}</td>
                                        <td className="p-3">{req.supervisor_name || 'N/A'}</td>
                                        <td className="p-3">
                                            <span className={`px-2 py-0.5 rounded ${req.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                                                req.status === 'approved' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                                }`}>
                                                {req.status}
                                            </span>
                                        </td>
                                        <td className="p-3 truncate max-w-[200px]" title={req.reason}>{req.reason}</td>
                                        <td className="p-3 text-gray-400">{req.project_id}</td>
                                        <td className="p-3">{new Date(req.created_at || req.date).toLocaleString()}</td>
                                    </tr>
                                )) : (
                                    <tr>
                                        <td colSpan={7} className="p-6 text-center text-gray-400 italic">
                                            No records found in "unlock_requests" for this project ID.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {!report && (
                <div className="text-center py-10 text-gray-400">Loading diagnostics...</div>
            )}
        </div>
    );
};

export default HealthCheck;
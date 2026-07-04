import React, { useState, useEffect, useRef } from 'react';
import { collection, query, onSnapshot, doc, updateDoc, deleteDoc, writeBatch, getDocs } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { EngravingOrder, EngravingStatus, EngravingStats } from '../types';
import { 
  Copy, Check, Search, TrendingUp, Clock, AlertTriangle, Play, CheckSquare, 
  Trash2, Filter, Sparkles, Volume2, VolumeX, BarChart2, ShieldAlert, BadgeMinus,
  RefreshCw, Layers, FileDown, HelpCircle, Cpu, Lock, QrCode, Camera, UploadCloud, DownloadCloud, Wifi, WifiOff,
  Coins, DollarSign, FileText, Printer
} from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

interface OperatorDashboardProps {
  onBackToRoleSelection: () => void;
  currentPasscode?: string;
  onUpdatePasscode?: (newPasscode: string) => void;
}

export default function OperatorDashboard({ 
  onBackToRoleSelection,
  currentPasscode = '1234',
  onUpdatePasscode
}: OperatorDashboardProps) {
  const [orders, setOrders] = useState<EngravingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filtering and Searching State
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | EngravingStatus>('all');
  
  // Double-Check helper input
  const [doubleCheckCode, setDoubleCheckCode] = useState('');
  
  // State for showing copy triggers check mark feedback per-field (e.g. { 'orderId_field': true })
  const [copiedStates, setCopiedStates] = useState<Record<string, boolean>>({});
  
  // Sound Notification Toggle
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [newOrderAlert, setNewOrderAlert] = useState<string | null>(null);
  const [showLightBurnModal, setShowLightBurnModal] = useState(false);
  
  // Passcode Settings Modal States
  const [showPasscodeModal, setShowPasscodeModal] = useState(false);
  const [newPasscode, setNewPasscode] = useState('');
  const [passcodeConfirm, setPasscodeConfirm] = useState('');
  const [passcodeError, setPasscodeError] = useState('');
  const [passcodeSuccess, setPasscodeSuccess] = useState(false);

  // Offline & QR Sync States
  const [showQrScanModal, setShowQrScanModal] = useState(false);
  const [qrScanSuccessMessage, setQrScanSuccessMessage] = useState('');
  const [qrScanError, setQrScanError] = useState('');

  const [showBackupModal, setShowBackupModal] = useState(false);
  const [backupSuccessMessage, setBackupSuccessMessage] = useState('');
  const [backupErrorMessage, setBackupErrorMessage] = useState('');

  // PDF Report Generation Modal States
  const [showPdfModal, setShowPdfModal] = useState(false);
  const [pdfRaceName, setPdfRaceName] = useState('ANNUAL MARATHON CHAMPIONSHIP');
  const [pdfReportFilter, setPdfReportFilter] = useState<'all' | 'completed' | 'queued' | 'inprogress' | 'ready'>('all');

  // Dual Offline LAN + Firestore sync managers
  const [lanConnected, setLanConnected] = useState<boolean | null>(null);
  const [pricePerMedal, setPricePerMedal] = useState<number>(() => {
    const saved = localStorage.getItem('price_per_medal');
    return saved ? parseFloat(saved) : 150; // Default price per medal
  });

  const handlePriceChange = (val: number) => {
    setPricePerMedal(val);
    localStorage.setItem('price_per_medal', val.toString());
  };

  const [deleteConfirmOrder, setDeleteConfirmOrder] = useState<EngravingOrder | null>(null);
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false);

  const firestoreOrdersRef = useRef<EngravingOrder[]>([]);
  const localOrdersRef = useRef<EngravingOrder[]>([]);
  
  // Track previous count to sound alert on new arrivals
  const prevCountRef = useRef<number>(0);
  const ordersRef = useRef<EngravingOrder[]>([]);
  ordersRef.current = orders;
  const soundEnabledRef = useRef<boolean>(soundEnabled);
  soundEnabledRef.current = soundEnabled;

  // Unified data blending merger with timestamp-based conflict resolving
  const mergeAndPublish = () => {
    const combinedMap = new Map<string, EngravingOrder>();

    const insertOrResolve = (o: EngravingOrder) => {
      const existing = combinedMap.get(o.id);
      if (!existing) {
        combinedMap.set(o.id, o);
      } else {
        const timeExisting = new Date(existing.updatedAt).getTime() || 0;
        const timeNew = new Date(o.updatedAt).getTime() || 0;
        if (timeNew > timeExisting) {
          combinedMap.set(o.id, o);
        }
      }
    };

    // Populate both sources
    firestoreOrdersRef.current.forEach(insertOrResolve);
    localOrdersRef.current.forEach(insertOrResolve);

    const mergedList = Array.from(combinedMap.values());

    // Clean sort: completed at bottom, ready above it, inprogress, newest queued at very top
    mergedList.sort((a, b) => {
      const orderWeight = {
        inprogress: 1,
        queued: 2,
        ready: 3,
        completed: 4
      };
      const weightA = orderWeight[a.status] || 99;
      const weightB = orderWeight[b.status] || 99;
      
      if (weightA !== weightB) {
        return weightA - weightB;
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    // Sound notification on actual new additions to merged listings
    if (mergedList.length > prevCountRef.current && prevCountRef.current > 0) {
      const newlyAdded = mergedList.filter(o => !ordersRef.current.some(exist => exist.id === o.id))[0];
      if (newlyAdded) {
        setNewOrderAlert(`New Order Loaded: ${newlyAdded.runnerName} [Code: ${newlyAdded.id}]`);
        setTimeout(() => setNewOrderAlert(null), 5000);
        
        if (soundEnabledRef.current) {
          triggerBeepSound();
        }
      }
    }

    setOrders(mergedList);
    prevCountRef.current = mergedList.length;
    setLoading(false);
  };

  // 1. Firestore Cloud Database Listener
  useEffect(() => {
    const q = query(collection(db, 'orders'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const ordersList: EngravingOrder[] = [];
      snapshot.forEach((docSnap) => {
        ordersList.push(docSnap.data() as EngravingOrder);
      });
      
      firestoreOrdersRef.current = ordersList;
      mergeAndPublish();
    }, (error) => {
      console.warn("Cloud Firestore stream offline or restricted: ", error.message);
      // We do not freeze UI since offline LAN sync runs in parallel
    });

    return () => unsubscribe();
  }, []);

  // 2. Offsite LAN Local Express Syner
  useEffect(() => {
    const pollLocalServer = async () => {
      try {
        const res = await fetch('/api/orders');
        if (!res.ok) {
          setLanConnected(false);
          return;
        }
        const data = await res.json();
        setLanConnected(true);
        localOrdersRef.current = data.orders || [];
        mergeAndPublish();
      } catch (err) {
        setLanConnected(false);
      }
    };

    pollLocalServer();
    const interval = setInterval(pollLocalServer, 2000); // 2-second fast response polling for operator responsive queue

    return () => clearInterval(interval);
  }, []);

  // Synthetic standard beep generator for web compatibility
  const triggerBeepSound = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      oscillator.type = 'sine';
      oscillator.frequency.value = 880; // High frequency beep
      gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
      
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.3);
    } catch (e) {
      console.log('Audios not allowed or failed to configure: ', e);
    }
  };

  // Stats calculation
  const stats: EngravingStats = orders.reduce((acc, order) => {
    acc.total += 1;
    acc[order.status] += 1;
    
    const dist = order.distance || 'Other';
    acc.byDistance[dist] = (acc.byDistance[dist] || 0) + 1;
    
    return acc;
  }, {
    total: 0,
    queued: 0,
    inprogress: 0,
    ready: 0,
    completed: 0,
    byDistance: {} as Record<string, number>
  });

  // Action: Update Order Status
  const handleUpdateStatus = async (orderId: string, nextStatus: EngravingStatus) => {
    const docPath = `orders/${orderId}`;
    const timestamp = new Date().toISOString();
    
    // 1. Cloud write (ignore error if offline)
    try {
      const docRef = doc(db, 'orders', orderId);
      await updateDoc(docRef, {
        status: nextStatus,
        updatedAt: timestamp
      });
    } catch (e) {
      console.warn("Cloud Firestore update deferred or offline (LAN sync operates in parallel):", e);
    }

    // 2. Local LAN server write (for instant offline sync between laptops)
    try {
      const existingOrder = orders.find(o => o.id === orderId);
      if (existingOrder) {
        const updatedOrder = {
          ...existingOrder,
          status: nextStatus,
          updatedAt: timestamp
        };
        await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedOrder)
        });
        console.log("LAN Server sync: Updated order status successfully to " + nextStatus);
      }
    } catch (laneErr) {
      console.warn("LAN status sync skipped (no active local Express backend detected):", laneErr);
    }
  };

  // Action: Trigger Custom Confirmation Deletion
  const handleDeleteOrder = (orderId: string, runner: string) => {
    const found = orders.find(o => o.id === orderId);
    if (found) {
      setDeleteConfirmOrder(found);
    } else {
      setDeleteConfirmOrder({
        id: orderId,
        runnerName: runner,
        bibNumber: 'N/A',
        distance: 'Unknown',
        finishingTime: '00:00:00',
        status: 'queued',
        createdAt: new String(new Date().toISOString()).toString(),
        updatedAt: new String(new Date().toISOString()).toString()
      } as EngravingOrder);
    }
  };

  // Action: Perform Actual Single Order Deletion
  const handleExecuteDeleteOrder = async () => {
    if (!deleteConfirmOrder) return;
    const { id: orderId } = deleteConfirmOrder;
    setDeleteConfirmOrder(null);

    // 1. Cloud delete
    try {
      await deleteDoc(doc(db, 'orders', orderId));
    } catch (e) {
      console.warn("Cloud Firestore delete offline or deferred:", e);
    }

    // 2. Local LAN delete
    try {
      await fetch(`/api/orders/${orderId}`, {
        method: 'DELETE'
      });
      console.log("LAN Server sync: Deleted order offline successfully.");
    } catch (laneErr) {
      console.warn("LAN delete sync skipped:", laneErr);
    }
  };

  // Action: Trigger Custom Confirmation Purge (Fresh start on new race)
  const handlePurgeDatabase = () => {
    setShowPurgeConfirm(true);
  };

  // Action: Perform Actual Reset/Purge for Fresh Start
  const handleExecutePurgeDatabase = async () => {
    setShowPurgeConfirm(false);
    try {
      setLoading(true);
      
      // 1. Cloud purge
      const q = query(collection(db, 'orders'));
      const snapshot = await getDocs(q);
      const batch = writeBatch(db);
      
      snapshot.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });
      
      await batch.commit();
    } catch (e) {
      console.warn("Cloud database purge skipped/offline:", e);
    }

    // 2. Local LAN express server purge
    try {
      await fetch('/api/orders/reset', {
        method: 'POST'
      });
    } catch (laneErr) {
      console.warn("LAN purge sync skipped:", laneErr);
    } finally {
      setLoading(false);
    }
  };

  // Download orders as CSV perfectly mapped for LightBurn's Variable Text feature
  const handleDownloadCSV = () => {
    if (orders.length === 0) {
      alert("No active orders to export!");
      return;
    }

    // Sort orders: queued first (ready to engrave), then inprogress, then ready, then completed
    const orderPriority = { queued: 0, inprogress: 1, ready: 2, completed: 3 };
    const sortedOrders = [...orders].sort((a, b) => orderPriority[a.status] - orderPriority[b.status]);

    // CSV headers to easy bind in LightBurn: RefCode, Name, Bib, Time, Distance, Rank, Inscription, Status
    const headers = ["Index", "RefCode", "RunnerName", "BibNumber", "FinishingTime", "Distance", "Rank", "CustomInscription", "Status"];
    
    const rows = sortedOrders.map((order, idx) => [
      idx + 1,
      order.id,
      `"${order.runnerName.replace(/"/g, '""')}"`,
      `"${order.bibNumber.replace(/"/g, '""')}"`,
      `"${order.finishingTime.replace(/"/g, '""')}"`,
      `"${order.distance.replace(/"/g, '""')}"`,
      `"${(order.rank || '').replace(/"/g, '""')}"`,
      `"${(order.customInscription || '').replace(/"/g, '""')}"`,
      order.status
    ]);

    const csvContent = [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `racepulse_lightburn_sync.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Generate branded PDF report with custom race name
  const handleGeneratePdfReport = () => {
    const ordersToExport = pdfReportFilter === 'all' 
      ? orders 
      : orders.filter(o => o.status === pdfReportFilter);

    if (ordersToExport.length === 0) {
      alert("No orders match the selected filter!");
      return;
    }

    const doc = new jsPDF({ orientation: 'landscape' });
    
    // Add Header Banner
    doc.setFillColor(20, 20, 20);
    doc.rect(0, 0, 297, 30, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text(pdfRaceName.toUpperCase() || 'RACE MEDAL ENGRAVING REPORT', 14, 15);
    
    doc.setFontSize(10);
    doc.setTextColor(245, 158, 11); // Amber
    const dateStr = new Date().toLocaleString();
    doc.text(`Generated: ${dateStr}   |   Total Athletes: ${ordersToExport.length}   |   Status Filter: ${pdfReportFilter.toUpperCase()}`, 14, 24);

    // Prepare table rows
    const tableRows = ordersToExport.map((o, index) => [
      index + 1,
      o.bibNumber,
      o.runnerName,
      o.distance,
      o.finishingTime,
      o.rank || '-',
      o.customInscription || '-',
      o.status.toUpperCase()
    ]);

    autoTable(doc, {
      startY: 36,
      head: [['#', 'Bib', 'Athlete Name', 'Distance', 'Time', 'Rank', 'Inscription', 'Status']],
      body: tableRows,
      styles: { fontSize: 9, cellPadding: 3, textColor: [40, 40, 40] },
      headStyles: { fillColor: [30, 30, 35], textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 248, 250] },
      columnStyles: {
        0: { cellWidth: 12 },
        1: { cellWidth: 22, fontStyle: 'bold' },
        2: { cellWidth: 50 },
        3: { cellWidth: 25 },
        4: { cellWidth: 25 },
        5: { cellWidth: 20 },
        6: { cellWidth: 85 },
        7: { cellWidth: 30 }
      },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 7) {
          const val = data.cell.raw as string;
          if (val === 'COMPLETED') {
            data.cell.styles.textColor = [16, 185, 129];
            data.cell.styles.fontStyle = 'bold';
          } else if (val === 'INPROGRESS') {
            data.cell.styles.textColor = [245, 158, 11];
            data.cell.styles.fontStyle = 'bold';
          } else if (val === 'QUEUED') {
            data.cell.styles.textColor = [99, 102, 241];
          }
        }
      }
    });

    const sanitizedFileName = (pdfRaceName.trim() || 'Race_Report').replace(/[^a-zA-Z0-9_-]/g, '_');
    doc.save(`${sanitizedFileName}_Medals_Report.pdf`);
    setShowPdfModal(false);
  };

  // Clipboard Copier Trigger helper
  const handleCopyText = (key: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopiedStates(prev => ({ ...prev, [key]: true }));
    setTimeout(() => {
      setCopiedStates(prev => ({ ...prev, [key]: false }));
    }, 1500);
  };

  // Update System passcode
  const handleSavePasscode = (e: React.FormEvent) => {
    e.preventDefault();
    setPasscodeError('');
    setPasscodeSuccess(false);

    if (!newPasscode.trim()) {
      setPasscodeError('Passcode cannot be empty.');
      return;
    }

    if (newPasscode !== passcodeConfirm) {
      setPasscodeError('New passcodes do not match.');
      return;
    }

    if (onUpdatePasscode) {
      onUpdatePasscode(newPasscode);
      setPasscodeSuccess(true);
      setNewPasscode('');
      setPasscodeConfirm('');
      setTimeout(() => {
        setPasscodeSuccess(false);
        setShowPasscodeModal(false);
      }, 1550);
    } else {
      setPasscodeError('A system error occurred. Cannot update.');
    }
  };

  // Register a scanned offline QR ticket
  const handleRegisterScannedOrder = async (qrDataText: string) => {
    setQrScanError('');
    setQrScanSuccessMessage('');
    try {
      let parsedOrder: Partial<EngravingOrder> = {};

      if (qrDataText.startsWith("RXPv2|") || qrDataText.includes("|")) {
        const parts = qrDataText.split("|");
        if (parts.length >= 4) {
          parsedOrder = {
            id: parts[1],
            runnerName: parts[2],
            bibNumber: parts[3],
            distance: parts[4] || 'Marathon',
            finishingTime: parts[5] || '00:00:00',
            rank: parts[6] || '',
            customInscription: parts[7] || '',
            status: 'queued'
          };
        } else {
          throw new Error("Invalid or abbreviated pipe QR Sync format.");
        }
      } else {
        const data = JSON.parse(qrDataText);
        if (!data.id || !data.rn || !data.bn) {
          throw new Error("Invalid or incompatible QR Sync Ticket format.");
        }
        parsedOrder = {
          id: data.id,
          runnerName: data.rn,
          bibNumber: data.bn,
          distance: data.ds || 'Marathon',
          finishingTime: data.ft || '00:00:00',
          rank: data.rk || '',
          customInscription: data.ci || '',
          status: data.st || 'queued'
        };
      }

      if (!parsedOrder.id || !parsedOrder.runnerName || !parsedOrder.bibNumber) {
        throw new Error("Missing critical runner details in QR code.");
      }

      const timestamp = new Date().toISOString();
      const scannedOrder: EngravingOrder = {
        id: parsedOrder.id,
        runnerName: parsedOrder.runnerName,
        bibNumber: parsedOrder.bibNumber,
        distance: parsedOrder.distance || 'Marathon',
        finishingTime: parsedOrder.finishingTime || '00:00:00',
        rank: parsedOrder.rank || '',
        customInscription: parsedOrder.customInscription || '',
        status: parsedOrder.status || 'queued',
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      // Check if order already exists in current lists to prevent silent overwrite
      const exists = orders.some(o => o.id === scannedOrder.id);
      let targetId = scannedOrder.id;
      if (exists) {
        const confirmOverwrite = window.confirm(`Order code "${targetId}" ("${scannedOrder.runnerName}") is already in the queue. Do you want to overwrite it with this scanned sync data? OK to overwrite, Cancel to add as a new entry with dynamic suffix.`);
        if (!confirmOverwrite) {
          targetId = `${scannedOrder.id}-${Math.floor(100 + Math.random() * 900)}`;
          scannedOrder.id = targetId;
        }
      }

      // Save using setDoc so it writes to local IndexDB cache first (works 100% offline!)
      const { setDoc, doc } = await import('firebase/firestore');
      await setDoc(doc(db, 'orders', targetId), scannedOrder);

      // Trigger standard incoming beep alert manually
      triggerBeepSound();

      setQrScanSuccessMessage(`Successfully loaded ticket #${targetId} for "${scannedOrder.runnerName}" into queue!`);
      return true;
    } catch (err: any) {
      setQrScanError(err.message || "Failed to parse coupon details.");
      return false;
    }
  };

  // Bulk Export orders to JSON
  const handleExportOfflineBackup = () => {
    setBackupSuccessMessage('');
    setBackupErrorMessage('');
    try {
      const dataStr = JSON.stringify(orders, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const dateStr = new Date().toISOString().slice(0, 10);
      link.download = `racepulse_offline_backup_${dateStr}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setBackupSuccessMessage('Backup exported successfully to downloads!');
    } catch (err: any) {
      setBackupErrorMessage(err.message || 'Error occurred during export.');
    }
  };

  // Bulk Import orders from JSON
  const handleImportOfflineBackup = async (file: File) => {
    setBackupSuccessMessage('');
    setBackupErrorMessage('');
    try {
      const text = await file.text();
      const imported = JSON.parse(text);
      if (!Array.isArray(imported)) {
        throw new Error("Invalid file content. Expected an array of engraving orders.");
      }

      let count = 0;
      const { setDoc } = await import('firebase/firestore');
      
      for (const item of imported) {
        if (!item.id || !item.runnerName || !item.bibNumber) {
          continue; // skip corrupt items
        }
        
        // Save using setDoc so it merges into indexDB and Firestore seamlessly
        await setDoc(doc(db, 'orders', item.id), {
          ...item,
          status: item.status || 'queued',
          createdAt: item.createdAt || new Date().toISOString(),
          updatedAt: item.updatedAt || new Date().toISOString()
        });
        count++;
      }

      triggerBeepSound();
      setBackupSuccessMessage(`Successfully imported and synchronized ${count} orders from JSON file!`);
    } catch (err: any) {
      setBackupErrorMessage(err.message || "Failed to load backup file.");
    }
  };

  // Copy Complete TSV row format (Runner Name, Bib, Distance, Time, Rank, Inscription)
  const handleCopyTSVRow = (order: EngravingOrder) => {
    const row = [
      order.runnerName,
      order.bibNumber,
      order.distance,
      order.finishingTime,
      order.rank || '',
      order.customInscription || ''
    ].join('\t'); // Tab separated is optimal for Excel paste!
    
    handleCopyText(`${order.id}_tsv_all`, row);
  };

  // Filters application
  const filteredOrders = orders.filter(o => {
    // Search match
    const matchSearch = 
      o.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      o.runnerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      o.bibNumber.includes(searchTerm);
      
    // Status match
    const matchStatus = statusFilter === 'all' ? true : o.status === statusFilter;
    
    return matchSearch && matchStatus;
  });

  // Isolated matched record for double check input
  const foundDoubleCheckOrder = doubleCheckCode.trim() 
    ? orders.find(o => o.id.toUpperCase() === doubleCheckCode.trim().toUpperCase())
    : null;

  return (
    <div id="operator_flow_main" className="w-full max-w-7xl mx-auto px-4 py-4 space-y-6">
      
      {/* Alert bar for live arrivals */}
      {newOrderAlert && (
        <div className="bg-gradient-to-r from-amber-600 to-amber-500 text-black px-5 py-3 rounded-[20px] font-black font-display shadow-2xl border border-amber-400 flex items-center justify-between text-xs tracking-wider uppercase animate-bounce">
          <div className="flex items-center gap-2">
            <span className="p-1.5 bg-black text-amber-500 rounded-lg">🔔</span>
            <span>{newOrderAlert}</span>
          </div>
          <button onClick={() => setNewOrderAlert(null)} className="text-black hover:text-white font-black text-sm ml-4">✕</button>
        </div>
      )}

      {/* Header Operator Info */}
      <div className="flex flex-col md:flex-row md:items-center justify-between glass-panel hero-glow px-4 sm:px-6 py-5 gap-4 animate-fadeIn">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] tracking-widest font-extrabold text-amber-500 font-display bg-amber-500/10 px-2.5 py-1 rounded-full uppercase border border-amber-500/20">Engraver Control</span>
            <span className="h-4 w-px bg-[var(--surface-hover)]"></span>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${typeof navigator !== 'undefined' && navigator.onLine ? 'bg-green-500 animate-pulse' : 'bg-rose-500 animate-ping'}`}></span>
              <span className="text-xs text-[var(--text-secondary)] font-bold uppercase tracking-wider font-mono flex items-center gap-1.5">
                {typeof navigator !== 'undefined' && navigator.onLine ? (
                  <>
                    <Wifi className="w-3.5 h-3.5 text-green-550" />
                    ONLINE CO-PROCESSING
                  </>
                ) : (
                  <>
                    <WifiOff className="w-3.5 h-3.5 text-rose-500 animate-pulse" />
                    OFFLINE SYNC MODE
                  </>
                )}
              </span>
            </div>
          </div>
          <h1 className="heading-float text-2xl font-black tracking-tight font-display text-[var(--text-primary)] mt-1.5 uppercase">Medal Engraving Command Center</h1>
          <p className="text-xs text-[var(--text-secondary)] mt-1">Copy-paste data directly to laser machine and handle runner statuses with zero miskey errors.</p>
        </div>

        {/* Action Controls right */}
        <div className="flex flex-wrap items-center gap-2">
          {/* LightBurn Guide Button */}
          <button
            onClick={() => setShowLightBurnModal(true)}
            className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-[20px] bg-[var(--surface-inset)]/75 backdrop-blur-md border border-[var(--border-default)] text-[var(--text-primary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition duration-150 uppercase tracking-wider"
            title="Open interactive manual for LightBurn Variable Text integration"
          >
            <HelpCircle className="w-4 h-4 text-amber-500" /> Guide
          </button>

          {/* Export CSV for LightBurn */}
          <button
            onClick={handleDownloadCSV}
            className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-[20px] bg-[var(--surface-card)]/72 backdrop-blur-2xl hover:bg-[var(--surface-inset)]/75 backdrop-blur-md text-amber-500 border border-[var(--border-default)] hover:border-[var(--border-default)] font-extrabold transition duration-150 uppercase tracking-wider active:scale-95"
            title="Download formatted CSV file to sync with LightBurn's Variable Text pane"
          >
            <FileDown className="w-4 h-4" /> Export CSV
          </button>

          {/* Generate PDF Report Button */}
          <button
            onClick={() => setShowPdfModal(true)}
            className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-[20px] bg-[var(--surface-card)]/72 backdrop-blur-2xl hover:bg-[var(--surface-inset)]/75 backdrop-blur-md text-red-400 border border-[var(--border-default)] hover:border-[var(--border-default)] font-extrabold transition duration-150 uppercase tracking-wider active:scale-95"
            title="Generate and download a printable PDF report of registered athletes and medal status"
          >
            <FileText className="w-4 h-4 text-red-400" /> PDF Report
          </button>

          {/* Scan Offline QR Ticket Button */}
          <button
            onClick={() => {
              setQrScanError('');
              setQrScanSuccessMessage('');
              setShowQrScanModal(true);
            }}
            className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-[20px] bg-violet-600 hover:bg-violet-500 text-white border border-violet-700 font-extrabold transition duration-150 uppercase tracking-wider active:scale-95"
            title="Activate laptop webcam to scan an offline runner's QR Sync Ticket"
          >
            <QrCode className="w-4 h-4 text-violet-200" /> Scan QR
          </button>

          {/* Offline Sync Backup Buttons */}
          <button
            onClick={() => {
              setBackupSuccessMessage('');
              setBackupErrorMessage('');
              setShowBackupModal(true);
            }}
            className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-[20px] bg-[var(--surface-card)]/72 backdrop-blur-2xl hover:bg-[var(--surface-inset)]/75 backdrop-blur-md border border-[var(--border-default)] hover:border-[var(--border-default)] text-green-500 font-extrabold transition duration-150 uppercase tracking-wider active:scale-95"
            title="Backup, export or import the entire queue for dual-laptop completely offline operations"
          >
            <DownloadCloud className="w-4 h-4 text-green-550" /> Offline Backup
          </button>

          {/* Beep toggle */}
          <button
            onClick={() => {
              setSoundEnabled(!soundEnabled);
              triggerBeepSound();
            }}
            className={`flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-[20px] border transition duration-150 uppercase tracking-wider ${
              soundEnabled 
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-500' 
                : 'bg-[var(--surface-inset)]/75 backdrop-blur-md border-[var(--border-default)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
            }`}
            title="Toggle buzzer sound when new customer submits engraving request"
          >
            {soundEnabled ? <Volume2 className="w-4 h-4 text-amber-500" /> : <VolumeX className="w-4 h-4 text-[var(--text-secondary)]" />}
            {soundEnabled ? "Buzzer On" : "Buzzer Off"}
          </button>

          {/* Purge / Clear DB */}
          <button
            onClick={handlePurgeDatabase}
            className="text-xs text-[var(--text-secondary)] hover:text-red-400 hover:bg-red-950/20 border border-[var(--border-default)] hover:border-red-900 font-bold px-3.5 py-2 rounded-[20px] transition duration-150 flex items-center gap-1.5 uppercase tracking-wider"
            title="Deletes all database documents for a completely fresh queue."
          >
            <Trash2 className="w-3.5 h-3.5" /> Purge DB
          </button>

          {/* Change Passcode */}
          <button
            onClick={() => {
              setNewPasscode('');
              setPasscodeConfirm('');
              setPasscodeError('');
              setPasscodeSuccess(false);
              setShowPasscodeModal(true);
            }}
            className="text-xs text-[var(--text-secondary)] border border-[var(--border-default)] hover:bg-[var(--surface-inset)]/75 backdrop-blur-md hover:text-[var(--text-primary)] font-bold px-3.5 py-2 rounded-[20px] transition flex items-center gap-1.5 uppercase tracking-wider"
            title="Change operator access passcode"
          >
            <Lock className="w-3.5 h-3.5 text-amber-500" /> Passcode
          </button>
          
          <button 
            onClick={onBackToRoleSelection}
            className="text-xs text-[var(--text-secondary)] border border-[var(--border-default)] hover:bg-[var(--surface-inset)]/75 backdrop-blur-md hover:text-[var(--text-primary)] font-bold px-3.5 py-2 rounded-[20px] transition flex items-center gap-1.5 uppercase tracking-wider"
          >
            ← Exit Panel
          </button>
        </div>
      </div>

      {/* Tally and Metrics section */}
      <div id="operator_stats_grid" className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-4">
        
        {/* Total Avails */}
        <div className="bg-[var(--surface-card)]/72 backdrop-blur-2xl border border-[var(--border-subtle)] rounded-[20px] p-4 shadow-sm flex items-center gap-3">
          <div className="p-3 bg-amber-500/10 text-amber-500 rounded-lg">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div>
            <span className="block text-[9px] uppercase font-extrabold text-[var(--text-secondary)] tracking-wider">Total Availed</span>
            <span className="text-xl font-black font-mono text-[var(--text-primary)] leading-none">{stats.total}</span>
            <span className="text-[9px] block text-[var(--text-secondary)] mt-0.5 font-medium">Recorded Submissions</span>
          </div>
        </div>

        {/* Queued */}
        <div className="bg-[var(--surface-card)]/72 backdrop-blur-2xl border border-[var(--border-subtle)] rounded-[20px] p-4 shadow-sm flex items-center gap-3">
          <div className="p-3 bg-amber-500/10 text-amber-500 rounded-lg">
            <Clock className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <span className="block text-[9px] uppercase font-extrabold text-[var(--text-secondary)] tracking-wider">Queue Backlog</span>
            <span className="text-xl font-black font-mono text-amber-500 leading-none">{stats.queued}</span>
            <span className="text-[9px] block text-[var(--text-secondary)] mt-0.5 font-medium">Awaiting Laser Cut</span>
          </div>
        </div>

        {/* In Progress */}
        <div className="bg-[var(--surface-card)]/72 backdrop-blur-2xl border border-[var(--border-subtle)] rounded-[20px] p-4 shadow-sm flex items-center gap-3">
          <div className="p-3 bg-orange-500/10 text-orange-500 rounded-lg animate-pulse">
            <Play className="w-5 h-5 fill-orange-500" />
          </div>
          <div>
            <span className="block text-[9px] uppercase font-extrabold text-[var(--text-secondary)] tracking-wider">Laser Active</span>
            <span className="text-xl font-black font-mono text-orange-500 leading-none">{stats.inprogress}</span>
            <span className="text-[9px] block text-[var(--text-secondary)] mt-0.5 font-medium">Engraving Ingress</span>
          </div>
        </div>

        {/* Ready */}
        <div className="bg-[var(--surface-card)]/72 backdrop-blur-2xl border border-[var(--border-subtle)] rounded-[20px] p-4 shadow-sm flex items-center gap-3">
          <div className="p-3 bg-blue-500/10 text-blue-400 rounded-lg">
            <Sparkles className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <span className="block text-[9px] uppercase font-extrabold text-[var(--text-secondary)] tracking-wider">Ready for P/U</span>
            <span className="text-xl font-black font-mono text-blue-400 leading-none">{stats.ready}</span>
            <span className="text-[9px] block text-[var(--text-secondary)] mt-0.5 font-medium">Standing by Cabin</span>
          </div>
        </div>

        {/* Completed */}
        <div className="bg-[var(--surface-card)]/72 backdrop-blur-2xl border border-[var(--border-subtle)] rounded-[20px] p-4 shadow-sm flex items-center gap-3">
          <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-lg">
            <CheckSquare className="w-5 h-5" />
          </div>
          <div>
            <span className="block text-[9px] uppercase font-extrabold text-[var(--text-secondary)] tracking-wider">Handed Over</span>
            <span className="text-xl font-black font-mono text-emerald-400 leading-none">{stats.completed}</span>
            <span className="text-[9px] block text-[var(--text-secondary)] mt-0.5 font-medium">Complete / Closed</span>
          </div>
        </div>

        {/* Price Per Medal Input */}
        <div className="bg-[var(--surface-card)]/72 backdrop-blur-2xl border border-[var(--border-subtle)] rounded-[20px] p-4 shadow-sm flex items-center gap-3">
          <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-lg">
            <Coins className="w-5 h-5 text-indigo-400" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="block text-[9px] uppercase font-extrabold text-[var(--text-secondary)] tracking-wider">Price per Medal</span>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-sm font-black font-mono text-amber-500">₱</span>
              <input
                type="number"
                min="0"
                value={pricePerMedal === 0 ? '' : pricePerMedal}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  handlePriceChange(isNaN(val) ? 0 : val);
                }}
                className="w-full bg-[var(--surface-inset)]/75 backdrop-blur-md text-[var(--text-primary)] border border-[var(--border-default)] rounded px-1.5 py-0.5 text-sm font-black font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="0"
              />
            </div>
            <span className="text-[9px] block text-[var(--text-secondary)] mt-1 font-medium leading-none">Setup pricing</span>
          </div>
        </div>

        {/* Total Earnings */}
        <div className="bg-[var(--surface-card)]/72 backdrop-blur-2xl border border-[var(--border-subtle)] rounded-[20px] p-4 shadow-sm flex items-center gap-3 col-span-2 sm:col-span-1">
          <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-lg">
            <DollarSign className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <span className="block text-[9px] uppercase font-extrabold text-indigo-400 tracking-wider">Total Earnings</span>
            <span className="text-lg font-black font-mono text-emerald-400 leading-none block mt-0.5">
              ₱{(stats.completed * pricePerMedal).toLocaleString()}
            </span>
            <span className="text-[9px] block text-[var(--text-secondary)] mt-1 font-mono leading-none">
              Potential: ₱{(stats.total * pricePerMedal).toLocaleString()}
            </span>
          </div>
        </div>

      </div>

      {/* Double-Check Code Lookup isolated verification */}
      <div id="double_check_terminal" className="bg-[var(--surface-card)]/72 backdrop-blur-2xl text-[var(--text-primary)] rounded-[26px] p-5 shadow-2xl border border-[var(--border-subtle)]">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-[var(--border-subtle)] pb-4 mb-4">
          <div>
            <h2 className="text-sm font-bold font-display text-amber-500 flex items-center gap-2 uppercase tracking-wide">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse"></span>
              Double-Check isolated Terminal
            </h2>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">Type or search any short ref code. Displays values in grand fonts to double check spelling.</p>
          </div>
          <div className="relative w-full md:w-56">
            <input
              type="text"
              placeholder="ENTER CODE (E.G. A29B)"
              maxLength={4}
              value={doubleCheckCode}
              onChange={(e) => setDoubleCheckCode(e.target.value.toUpperCase())}
              className="w-full bg-[var(--surface-inset)]/75 backdrop-blur-md text-[var(--text-primary)] border border-[var(--border-default)] rounded-[20px] px-3.5 py-2.5 text-xs font-bold font-mono tracking-widest placeholder-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
            {doubleCheckCode && (
              <button 
                onClick={() => setDoubleCheckCode('')}
                className="absolute right-3.5 top-3 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Found Result Panel */}
        {foundDoubleCheckOrder ? (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center bg-[var(--surface-inset)]/75 backdrop-blur-md border border-amber-500/20 rounded-[20px] p-4 animate-fadeIn">
            
            {/* Short Code badge */}
            <div className="md:col-span-2 text-center md:border-r border-[var(--border-subtle)] pr-2">
              <span className="text-[9px] text-[var(--text-secondary)] font-bold block uppercase tracking-wider">Matched Ref</span>
              <span className="text-4xl font-mono font-black text-amber-500 block my-1">{foundDoubleCheckOrder.id}</span>
              <span className="text-[10px] py-1 px-2.5 bg-amber-500 text-black rounded-lg inline-block font-black uppercase">
                {foundDoubleCheckOrder.status}
              </span>
            </div>

            {/* Huge copier display fields */}
            <div className="md:col-span-8 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              
              {/* Runner name */}
              <div className="bg-[var(--surface-card)]/60 border border-[var(--border-subtle)] rounded-[20px] p-3 relative group">
                <span className="block text-[9px] uppercase font-bold text-[var(--text-secondary)] tracking-wider">1. Runner Full Name</span>
                <span className="block text-xl font-black text-[var(--text-primary)] truncate pr-7 font-display mt-0.5">{foundDoubleCheckOrder.runnerName}</span>
                <button
                  onClick={() => handleCopyText('lookup_name', foundDoubleCheckOrder.runnerName)}
                  className="absolute right-2.5 bottom-2.5 text-[var(--text-secondary)] hover:text-amber-500 p-1.5 bg-[var(--surface-inset)]/75 backdrop-blur-md hover:bg-[var(--surface-hover)] rounded transition"
                  title="Copy Name"
                >
                  {copiedStates['lookup_name'] ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>

              {/* Finishing Time */}
              <div className="bg-[var(--surface-card)]/60 border border-[var(--border-subtle)] rounded-[20px] p-3 relative group">
                <span className="block text-[9px] uppercase font-bold text-[var(--text-secondary)] tracking-wider">2. Finishing Time</span>
                <span className="block text-xl font-mono font-black text-amber-500 pr-7 mt-0.5">{foundDoubleCheckOrder.finishingTime}</span>
                <button
                  onClick={() => handleCopyText('lookup_time', foundDoubleCheckOrder.finishingTime)}
                  className="absolute right-2.5 bottom-2.5 text-[var(--text-secondary)] hover:text-amber-500 p-1.5 bg-[var(--surface-inset)]/75 backdrop-blur-md hover:bg-[var(--surface-hover)] rounded transition"
                  title="Copy Time"
                >
                  {copiedStates['lookup_time'] ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>

              {/* Bib / Distance */}
              <div className="bg-[var(--surface-card)]/60 border border-[var(--border-subtle)] rounded-[20px] p-3 relative group">
                <span className="block text-[9px] uppercase font-bold text-[var(--text-secondary)] tracking-wider">3. Distance & Bib</span>
                <span className="block text-sm font-extrabold text-[var(--text-primary)] pr-6 truncate mt-1.5">
                  #{foundDoubleCheckOrder.bibNumber} &bull; <strong className="text-amber-400 font-bold">{foundDoubleCheckOrder.distance}</strong>
                </span>
                <div className="absolute right-2.5 bottom-2.5 flex gap-1">
                  <button
                    onClick={() => handleCopyText('lookup_bib', foundDoubleCheckOrder.bibNumber)}
                    className="text-[9px] font-black py-0.5 px-2 bg-[var(--surface-inset)]/75 backdrop-blur-md text-[var(--text-primary)] hover:text-amber-500 rounded border border-[var(--border-default)] transition"
                    title="Copy Bib"
                  >
                    Bib
                  </button>
                  <button
                    onClick={() => handleCopyText('lookup_dist', foundDoubleCheckOrder.distance)}
                    className="text-[9px] font-black py-0.5 px-2 bg-[var(--surface-inset)]/75 backdrop-blur-md text-[var(--text-primary)] hover:text-amber-500 rounded border border-[var(--border-default)] transition"
                    title="Copy Dist"
                  >
                    Dist
                  </button>
                </div>
              </div>

              {/* Rank (Optional) */}
              <div className="bg-[var(--surface-card)]/60 border border-[var(--border-subtle)] rounded-[20px] p-3 relative group col-span-1 sm:col-span-2 md:col-span-1">
                <span className="block text-[9px] uppercase font-bold text-[var(--text-secondary)] tracking-wider">4. Official Rank</span>
                <span className="block text-sm font-black text-amber-200 truncate mt-1">
                  {foundDoubleCheckOrder.rank || 'N/A (-)'}
                </span>
                {foundDoubleCheckOrder.rank && (
                  <button
                    onClick={() => handleCopyText('lookup_rank', foundDoubleCheckOrder.rank!)}
                    className="absolute right-2.5 bottom-2.5 text-[var(--text-secondary)] hover:text-amber-500 p-1.5 bg-[var(--surface-inset)]/75 backdrop-blur-md hover:bg-[var(--surface-hover)] rounded transition"
                    title="Copy Rank"
                  >
                    {copiedStates['lookup_rank'] ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>

              {/* Custom inscription */}
              <div className="bg-[var(--surface-card)]/60 border border-[var(--border-subtle)] rounded-[20px] p-3 relative group col-span-1 sm:col-span-2">
                <span className="block text-[9px] uppercase font-bold text-[var(--text-secondary)] tracking-wider">5. Custom Inscription Text</span>
                <span className="block text-xs italic text-[var(--text-primary)] mt-1.5 max-w-[90%] truncate">
                  {foundDoubleCheckOrder.customInscription ? `"${foundDoubleCheckOrder.customInscription}"` : 'No custom inscription text (-)'}
                </span>
                {foundDoubleCheckOrder.customInscription && (
                  <button
                    onClick={() => handleCopyText('lookup_inscription', foundDoubleCheckOrder.customInscription!)}
                    className="absolute right-2.5 bottom-2.5 text-[var(--text-secondary)] hover:text-amber-500 p-1.5 bg-[var(--surface-inset)]/75 backdrop-blur-md hover:bg-[var(--surface-hover)] rounded transition"
                    title="Copy Inscription"
                  >
                    {copiedStates['lookup_inscription'] ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>

            </div>

            {/* Instant excel copy row */}
            <div className="md:col-span-2 flex flex-col gap-2 mt-4 md:mt-0">
              <button
                onClick={() => handleCopyTSVRow(foundDoubleCheckOrder)}
                className="w-full text-xs font-black font-display uppercase tracking-widest py-3 bg-amber-500 hover:bg-amber-400 text-black rounded-[20px] transition flex items-center justify-center gap-1 border-b-2 border-amber-700 active:scale-95"
                title="Copies all fields as tab-separated values to paste row into software"
              >
                {copiedStates[`${foundDoubleCheckOrder.id}_tsv_all`] ? (
                  <>
                    <Check className="w-4 h-4 text-black" /> Copied Row!
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 text-black" /> Copy Row (TSV)
                  </>
                )}
              </button>
              
              <div className="flex gap-1.5">
                {foundDoubleCheckOrder.status === 'queued' && (
                  <button
                    onClick={() => handleUpdateStatus(foundDoubleCheckOrder.id, 'inprogress')}
                    className="flex-1 text-[9px] font-bold py-2 bg-orange-600 hover:bg-orange-500 rounded-lg transition text-white uppercase text-center"
                  >
                    Engrave
                  </button>
                )}
                {foundDoubleCheckOrder.status === 'inprogress' && (
                  <button
                    onClick={() => handleUpdateStatus(foundDoubleCheckOrder.id, 'ready')}
                    className="flex-1 text-[9px] font-bold py-2 bg-blue-600 hover:bg-blue-500 rounded-lg transition text-white uppercase text-center"
                  >
                    Mark Ready
                  </button>
                )}
                {foundDoubleCheckOrder.status === 'ready' && (
                  <button
                    onClick={() => handleUpdateStatus(foundDoubleCheckOrder.id, 'completed')}
                    className="flex-1 text-[9px] font-bold py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg transition text-white uppercase text-center"
                  >
                    Complete
                  </button>
                )}
              </div>
            </div>

          </div>
        ) : (
          <div className="bg-[var(--surface-inset)]/75 backdrop-blur-md p-4 rounded-[20px] text-center text-xs text-[var(--text-secondary)] font-sans border border-[var(--border-subtle)] leading-normal">
            {doubleCheckCode.trim() 
              ? `No active order found matched code: "${doubleCheckCode.toUpperCase()}"` 
              : "READY FOR DUAL SCREEN VERIFICATION. ENTER OR SCAN RUNNER'S PASSCODE TO ALIGN EXACT NAME AND PREVENTS MISTAKES."
            }
          </div>
        )}
      </div>

      {/* Orders Filter & Search bar */}
      <div className="flex flex-col md:flex-row items-center justify-between border border-[var(--border-subtle)] bg-[var(--surface-card)]/72 backdrop-blur-2xl rounded-[20px] p-4 shadow-xl gap-4">
        
        {/* Search Input Left */}
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-[var(--text-secondary)] absolute left-3.5 top-3.5" />
          <input
            type="text"
            placeholder="Search Name, Bib, or Code..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-[var(--surface-inset)]/75 backdrop-blur-md border border-[var(--border-default)] rounded-[20px] pl-10 pr-4 py-2.5 text-sm font-semibold text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-amber-500 transition"
          />
        </div>

        {/* Tab Filters right */}
        <div className="flex items-center gap-1 w-full md:w-auto overflow-x-auto py-1">
          <span className="text-[var(--text-secondary)] text-xs font-bold mr-2.5 whitespace-nowrap"><Filter className="w-3.5 h-3.5 inline mr-1 text-amber-500" /> STATUS:</span>
          
          {(['all', 'queued', 'inprogress', 'ready', 'completed'] as const).map((filterOpt) => (
            <button
              key={filterOpt}
              onClick={() => setStatusFilter(filterOpt)}
              className={`text-xs font-bold px-3 py-1.5 rounded-lg border uppercase whitespace-nowrap transition-all ${
                statusFilter === filterOpt
                  ? filterOpt === 'queued' ? 'bg-amber-500/10 border-amber-500/30 text-amber-500 font-bold'
                    : filterOpt === 'inprogress' ? 'bg-orange-500/10 border-orange-500/30 text-orange-400 font-bold animate-pulse'
                    : filterOpt === 'ready' ? 'bg-blue-500/10 border-blue-500/30 text-blue-400 font-bold'
                    : filterOpt === 'completed' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 font-bold'
                    : 'bg-amber-500 border-amber-500 text-black font-extrabold'
                  : 'bg-[var(--surface-inset)]/75 backdrop-blur-md border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--surface-inset)]/75 backdrop-blur-md hover:text-[var(--text-primary)]'
              }`}
            >
              {filterOpt === 'all' ? 'All Orders' : filterOpt}
              <span className="ml-1.5 px-1.5 py-[1px] bg-[var(--surface-inset)]/75 backdrop-blur-md rounded font-mono text-[9px] text-[var(--text-secondary)]">
                {filterOpt === 'all' ? stats.total 
                  : filterOpt === 'queued' ? stats.queued 
                  : filterOpt === 'inprogress' ? stats.inprogress 
                  : filterOpt === 'ready' ? stats.ready 
                  : stats.completed
                }
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Orders List Container */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 bg-[var(--surface-card)]/72 backdrop-blur-2xl border border-[var(--border-subtle)] rounded-[26px] space-y-3">
          <RefreshCw className="w-10 h-10 text-amber-500 animate-spin" />
          <p className="text-xs font-bold text-[var(--text-secondary)] font-display uppercase tracking-widest">Loading Live Registry...</p>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 bg-[var(--surface-card)]/72 backdrop-blur-2xl border border-[var(--border-subtle)] rounded-[26px] text-center px-4">
          <BadgeMinus className="w-12 h-12 text-[var(--text-muted)] mb-2" />
          <h3 className="text-sm font-bold text-[var(--text-primary)] font-display uppercase tracking-wider">No Engravings Found</h3>
          <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-sm">
            Try adjusting your search criteria, selecting another filter, or wait for runners to submit.
          </p>
        </div>
      ) : (
        <div id="orders_cards_list" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredOrders.map((order) => {
            const isTsvCopied = copiedStates[`${order.id}_tsv_all`];
            
            // Status-specific card accent colors
            const accents = {
              queued: 'border-l-4 border-l-amber-500 bg-amber-550/5',
              inprogress: 'border-l-4 border-l-orange-500 bg-orange-550/10 shadow-[0_0_15px_rgba(249,115,22,0.05)]',
              ready: 'border-l-4 border-l-blue-500 bg-blue-550/5',
              completed: 'border-l-4 border-l-[var(--border-default)] bg-[var(--surface-card)]/10 opacity-60 hover:opacity-100 transition duration-150'
            };

            const statusBadges = {
              queued: 'bg-amber-500/10 text-amber-505 border-amber-500/20',
              inprogress: 'bg-orange-500/10 text-orange-400 border-orange-500/20 animate-pulse',
              ready: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
              completed: 'bg-[var(--surface-hover)] text-[var(--text-secondary)] border-[var(--border-default)]'
            };

            return (
              <div 
                key={order.id} 
                className={`bg-[var(--surface-card)]/90 rounded-[20px] border border-[var(--border-subtle)] p-5 flex flex-col justify-between shadow-xl relative overflow-hidden transition-all duration-200 hover:border-[var(--border-default)] ${accents[order.status]}`}
              >
                
                {/* Upper row: ID and Status badges */}
                <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-bold text-[var(--text-secondary)] font-mono">CODE</span>
                    <span 
                      onClick={() => setDoubleCheckCode(order.id)}
                      className="text-lg font-black font-mono text-amber-500 hover:bg-amber-500/10 px-2 py-0.5 rounded cursor-pointer transition border border-dashed border-amber-500/25"
                      title="Click to double check this record in deep isolated panel"
                    >
                      {order.id}
                    </span>
                  </div>

                  <span className={`text-[9px] font-extrabold uppercase tracking-widest py-0.5 px-2 rounded-lg border ${statusBadges[order.status]}`}>
                    {order.status === 'inprogress' ? 'Engraving' : order.status}
                  </span>
                </div>

                {/* Core Field Contents */}
                <div className="space-y-3 flex-grow">
                  
                  {/* Runner Name Block */}
                  <div className="relative group/copy pr-6">
                    <span className="block text-[8px] uppercase font-bold text-[var(--text-secondary)] tracking-wider">Runner Name</span>
                    <strong className="text-base font-extrabold text-[var(--text-primary)] truncate block font-display">
                      {order.runnerName}
                    </strong>
                    <button
                      onClick={() => handleCopyText(`${order.id}_name`, order.runnerName)}
                      className="absolute right-0 top-1 text-[var(--text-secondary)] hover:text-amber-500 p-1 rounded hover:bg-[var(--surface-inset)]/75 backdrop-blur-md transition"
                      title="Copy Name"
                    >
                      {copiedStates[`${order.id}_name`] ? <Check className="w-3 text-emerald-500" /> : <Copy className="w-3" />}
                    </button>
                  </div>

                  {/* Bib & Distance Block */}
                  <div className="grid grid-cols-2 gap-2 border-t border-[var(--border-subtle)] pt-2 pb-1 text-xs text-[var(--text-primary)]">
                    <div>
                      <span className="block text-[8px] uppercase font-bold text-[var(--text-secondary)] tracking-wider">Bib Number</span>
                      <strong className="font-mono text-[var(--text-primary)] font-bold">{order.bibNumber}</strong>
                    </div>
                    <div>
                      <span className="block text-[8px] uppercase font-bold text-[var(--text-secondary)] tracking-wider">Distance</span>
                      <span className="text-[var(--text-primary)] font-bold truncate block">{order.distance}</span>
                    </div>
                  </div>

                  {/* Finishing Time Block with massive COPY BUTTON */}
                  <div className="bg-[var(--surface-inset)]/75 backdrop-blur-md border border-[var(--border-subtle)] px-3 py-2 rounded-lg flex items-center justify-between relative group/copy">
                    <div>
                      <span className="block text-[8px] uppercase font-bold text-[var(--text-secondary)] tracking-wider leading-none">Finishing Time</span>
                      <span className="text-base font-black font-mono text-[var(--text-primary)] mt-1 block">
                        {order.finishingTime}
                      </span>
                    </div>
                    <button
                      onClick={() => handleCopyText(`${order.id}_time`, order.finishingTime)}
                      className="text-[10px] font-bold text-[var(--text-primary)] bg-[var(--surface-inset)]/75 backdrop-blur-md hover:bg-[var(--surface-hover)] border border-[var(--border-default)] rounded-lg py-1 px-2.5 flex items-center gap-1 transition"
                      title="Copy Time Only"
                    >
                      {copiedStates[`${order.id}_time`] ? (
                        <>
                          <Check className="w-3 text-emerald-500" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 text-[var(--text-secondary)]" /> Copy
                        </>
                      )}
                    </button>
                  </div>

                  {/* Rank Block (Only if exists) */}
                  {order.rank && (
                    <div className="relative group/copy pr-6">
                      <span className="block text-[8px] uppercase font-bold text-[var(--text-secondary)] tracking-wider leading-none">Rank / Group</span>
                      <span className="text-xs font-semibold text-amber-200 block mt-0.5 truncate">{order.rank}</span>
                      <button
                        onClick={() => handleCopyText(`${order.id}_rank`, order.rank!)}
                        className="absolute right-0 top-0 text-[var(--text-secondary)] hover:text-amber-500 p-0.5 rounded transition"
                        title="Copy Rank"
                      >
                        {copiedStates[`${order.id}_rank`] ? <Check className="w-2.5 text-emerald-500" /> : <Copy className="w-2.5" />}
                      </button>
                    </div>
                  )}

                  {/* Custom Inscription Block (Only if exists) */}
                  {order.customInscription && (
                    <div className="relative group/copy pr-6 bg-amber-500/5 p-2.5 rounded-lg border border-amber-500/10">
                      <span className="block text-[8px] uppercase font-bold text-[var(--text-secondary)] tracking-wider leading-none">Custom Text</span>
                      <span className="text-xs italic text-[var(--text-primary)] block mt-1.5 truncate">"{order.customInscription}"</span>
                      <button
                        onClick={() => handleCopyText(`${order.id}_inscription`, order.customInscription!)}
                        className="absolute right-1 top-1.5 text-[var(--text-secondary)] hover:text-amber-500 p-0.5 rounded transition"
                        title="Copy Inscription Only"
                      >
                        {copiedStates[`${order.id}_inscription`] ? <Check className="w-2.5 text-emerald-500" /> : <Copy className="w-2.5" />}
                      </button>
                    </div>
                  )}

                </div>

                {/* Lower Action Workflow Controllers */}
                <div className="border-t border-[var(--border-subtle)] pt-3 mt-4 space-y-2">
                  <div className="flex gap-1.5">
                    
                    {/* Workflow status progressor */}
                    {order.status === 'queued' && (
                      <button
                        onClick={() => handleUpdateStatus(order.id, 'inprogress')}
                        className="flex-1 text-xs font-bold font-display uppercase tracking-widest py-2 bg-gradient-to-r from-orange-600 to-orange-500 hover:brightness-110 text-white rounded-[20px] shadow-sm transition flex items-center justify-center gap-1 active:scale-95"
                      >
                        <Play className="w-3.5 h-3.5 fill-white" /> Start Laser
                      </button>
                    )}

                    {order.status === 'inprogress' && (
                      <button
                        onClick={() => handleUpdateStatus(order.id, 'ready')}
                        className="flex-1 text-xs font-bold font-display uppercase tracking-widest py-2 bg-gradient-to-r from-blue-600 to-blue-550 hover:brightness-110 text-white rounded-[20px] shadow-sm transition flex items-center justify-center gap-1 active:scale-95"
                      >
                        <CheckSquare className="w-3.5 h-3.5" /> Mark Ready
                      </button>
                    )}

                    {order.status === 'ready' && (
                      <button
                        onClick={() => handleUpdateStatus(order.id, 'completed')}
                        className="flex-1 text-xs font-bold font-display uppercase tracking-widest py-2 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:brightness-110 text-white rounded-[20px] shadow-sm transition flex items-center justify-center gap-1 active:scale-95"
                      >
                        ✓ Picked Up
                      </button>
                    )}

                    {order.status === 'completed' && (
                      <div className="flex-grow flex justify-between items-center bg-[var(--surface-inset)]/75 backdrop-blur-md rounded-lg px-3 py-1.5 border border-[var(--border-subtle)] text-[var(--text-secondary)] text-[11px] font-semibold">
                        <span className="uppercase text-[9px] tracking-wider text-emerald-500">Done &bull; Safe Handed over</span>
                        <button 
                          onClick={() => handleUpdateStatus(order.id, 'queued')}
                          className="text-xs text-[var(--text-secondary)] hover:text-amber-500 transition font-bold"
                          title="Put back in queue"
                        >
                          Requeue
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Full Row (TSV Excel) copier option */}
                  <div className="flex justify-between items-center gap-2 pt-1">
                    <button
                      onClick={() => handleCopyTSVRow(order)}
                      className={`text-[9px] font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center gap-1 rounded-lg border border-[var(--border-subtle)] py-1 px-2 hover:bg-[var(--surface-inset)]/75 backdrop-blur-md shadow-3xs transition-all ${
                        isTsvCopied ? 'border-emerald-800 text-emerald-400 bg-emerald-950/20' : 'bg-transparent'
                      }`}
                      title="Copy complete row values tab-separated to insert in Excel sheets"
                    >
                      {isTsvCopied ? <Check className="w-2.5 text-emerald-500" /> : <Copy className="w-2.5" />}
                      {isTsvCopied ? 'Row Copied!' : 'Copy Row (TSV)'}
                    </button>
                    
                    <button
                      onClick={() => handleDeleteOrder(order.id, order.runnerName)}
                      className="text-[9px] font-bold text-[var(--text-secondary)] hover:text-red-400 p-1 flex items-center gap-0.5 hover:bg-red-950/10 rounded transition"
                      title="Delete / cancel order"
                    >
                      <Trash2 className="w-2.5 h-2.5" /> Delete
                    </button>
                  </div>
                </div>

              </div>
            );
          })}
        </div>
      )}

      {/* Footer stats Breakdown by race distance */}
      {!loading && orders.length > 0 && (
        <div id="distance_aggregate_summary" className="bg-[var(--surface-card)]/72 backdrop-blur-2xl border border-[var(--border-subtle)] rounded-[20px] p-5 shadow-2xl space-y-4">
          <h3 className="text-xs font-bold font-display uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-1.5 mb-2 border-b border-[var(--border-subtle)] pb-2.5">
            <BarChart2 className="w-4 h-4 text-amber-500" />
            Engraving Tally Breakdown by Distance Category
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {Object.entries(stats.byDistance).map(([distName, distCount]) => (
              <div key={distName} className="bg-[var(--surface-inset)]/75 backdrop-blur-md border border-[var(--border-subtle)] rounded-[20px] p-3 text-center">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] truncate" title={distName}>
                  {distName}
                </span>
                <span className="text-lg font-black text-[var(--text-primary)] font-mono block mt-1">
                  {distCount}
                </span>
                <span className="text-[9px] text-[var(--text-muted)] block mt-0.5 font-medium">
                  ({Math.round((distCount / stats.total) * 100)}% of total)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* LightBurn Integration Guide Modal */}
      {showLightBurnModal && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fadeIn transition-all">
          <div className="bg-[var(--surface-card)]/72 backdrop-blur-2xl border border-[var(--border-default)] rounded-[26px] w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="p-5 border-b border-[var(--border-subtle)] flex items-center justify-between bg-[var(--surface-inset)]/75 backdrop-blur-md">
              <div className="flex items-center gap-2">
                <Cpu className="w-5 h-5 text-amber-500 animate-pulse" />
                <div>
                  <h2 className="heading-float text-md font-black tracking-tight font-display text-[var(--text-primary)] uppercase">LightBurn Variable-Text Integration</h2>
                  <p className="text-[10px] text-[var(--text-secondary)] font-mono">AUTOMATED medal ENGRAVING PIPELINE</p>
                </div>
              </div>
              <button 
                onClick={() => setShowLightBurnModal(false)}
                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition bg-[var(--surface-inset)]/75 backdrop-blur-md border border-[var(--border-default)] hover:border-[var(--border-default)] p-2 rounded-[20px] text-xs font-bold uppercase tracking-wider px-3"
              >
                ✕ Close
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-5 text-[var(--text-primary)] text-sm leading-relaxed scrollbar-thin">
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-[20px] p-4 flex items-start gap-3">
                <div className="p-2 bg-amber-500/10 text-amber-500 rounded-lg shrink-0">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-extrabold text-amber-400 uppercase tracking-wider mb-1">Ditch Copy & Paste entirely!</h4>
                  <p className="text-xs text-[var(--text-secondary)]">
                    By combining this web app with LightBurn's native <strong>Variable Text</strong> functionality, your laser machine can read registered athlete data directly from a local CSV spreadsheet file. No typing, no spelling mistakes!
                  </p>
                </div>
              </div>

              {/* Step-by-step instructions */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-widest border-b border-[var(--border-subtle)] pb-2">Step-by-step Connection process</h3>
                
                {/* Step 1 */}
                <div className="flex gap-3">
                  <div className="text-xs font-mono font-bold w-5 h-5 bg-[var(--surface-hover)] text-amber-500 rounded-full flex items-center justify-center shrink-0 border border-[var(--border-default)]">1</div>
                  <div>
                    <h5 className="text-xs font-bold text-[var(--text-primary)] uppercase">Export the Data Feed</h5>
                    <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                      Click the <span className="text-amber-500 font-bold font-mono">Export CSV</span> button on the top right of this command panel. Save the <code className="text-[11px] text-[var(--text-primary)] font-mono bg-[var(--surface-inset)]/75 backdrop-blur-md px-1 py-0.5 rounded">racepulse_lightburn_sync.csv</code> on your laser station computer.
                    </p>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="flex gap-3">
                  <div className="text-xs font-mono font-bold w-5 h-5 bg-[var(--surface-hover)] text-amber-500 rounded-full flex items-center justify-center shrink-0 border border-[var(--border-default)]">2</div>
                  <div>
                    <h5 className="text-xs font-bold text-[var(--text-primary)] uppercase">Prepare your Laser Inscriptions in LightBurn</h5>
                    <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                      Create standard text objects in your medal border template. Set their source format to <strong>"Variable Text"</strong> instead of "Normal" in the top-bar dropdown. Use the respective %-index codes below:
                    </p>
                    <div className="grid grid-cols-2 gap-2 mt-2 font-mono text-[10px]">
                      <div className="bg-[var(--surface-card)]/72 backdrop-blur-2xl p-2 rounded border border-[var(--border-subtle)]">
                        <span className="text-amber-500 font-extrabold">%2</span> &rarr; Runner Name
                      </div>
                      <div className="bg-[var(--surface-card)]/72 backdrop-blur-2xl p-2 rounded border border-[var(--border-subtle)]">
                        <span className="text-amber-500 font-extrabold">%3</span> &rarr; Bib Number
                      </div>
                      <div className="bg-[var(--surface-card)]/72 backdrop-blur-2xl p-2 rounded border border-[var(--border-subtle)]">
                        <span className="text-amber-500 font-extrabold">%4</span> &rarr; Finishing Time
                      </div>
                      <div className="bg-[var(--surface-card)]/72 backdrop-blur-2xl p-2 rounded border border-[var(--border-subtle)]">
                        <span className="text-amber-500 font-extrabold">%5</span> &rarr; Race Distance
                      </div>
                      <div className="bg-[var(--surface-card)]/72 backdrop-blur-2xl p-2 rounded border border-[var(--border-subtle)]">
                        <span className="text-amber-500 font-extrabold">%6</span> &rarr; Rank / Category
                      </div>
                      <div className="bg-[var(--surface-card)]/72 backdrop-blur-2xl p-2 rounded border border-[var(--border-subtle)]">
                        <span className="text-amber-500 font-extrabold">%7</span> &rarr; Custom Inscription
                      </div>
                    </div>
                  </div>
                </div>

                {/* Step 3 */}
                <div className="flex gap-3">
                  <div className="text-xs font-mono font-bold w-5 h-5 bg-[var(--surface-hover)] text-amber-500 rounded-full flex items-center justify-center shrink-0 border border-[var(--border-default)]">3</div>
                  <div>
                    <h5 className="text-xs font-bold text-[var(--text-primary)] uppercase">Enable Variable Text Toolbar</h5>
                    <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                      Go to the top menu bar in LightBurn: <span className="font-mono text-[var(--text-primary)] text-xs bg-[var(--surface-inset)]/75 backdrop-blur-md px-1 py-0.5 rounded">Window &rarr; Variable Text</span> to display the controls.
                    </p>
                  </div>
                </div>

                {/* Step 4 */}
                <div className="flex gap-3">
                  <div className="text-xs font-mono font-bold w-5 h-5 bg-[var(--surface-hover)] text-amber-500 rounded-full flex items-center justify-center shrink-0 border border-[var(--border-default)]">4</div>
                  <div>
                    <h5 className="text-xs font-bold text-[var(--text-primary)] uppercase">Link the CSV Document</h5>
                    <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                      In the newly opened <strong>Variable Text</strong> panel, click <strong>"Browse"</strong> and select your downloaded CSV file. Look at your canvas; the %-codes will automatically compile into active runner data!
                    </p>
                  </div>
                </div>

                {/* Step 5 */}
                <div className="flex gap-3">
                  <div className="text-xs font-mono font-bold w-5 h-5 bg-[var(--surface-hover)] text-amber-500 rounded-full flex items-center justify-center shrink-0 border border-[var(--border-default)]">5</div>
                  <div>
                    <h5 className="text-xs font-bold text-[var(--text-primary)] uppercase">Rapid Laser Output Selection</h5>
                    <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                      Toggle the row indices using the <strong>Previous ( &larr; )</strong> and <strong>Next ( &rarr; )</strong> arrow control keys in Lightburn to cycle from athlete to athlete. Lighturn updates the artwork instantly!
                    </p>
                  </div>
                </div>

                {/* Step 6 */}
                <div className="flex gap-3">
                  <div className="text-xs font-mono font-bold w-5 h-5 bg-[var(--surface-hover)] text-amber-500 rounded-full flex items-center justify-center shrink-0 border border-[var(--border-default)]">6</div>
                  <div>
                    <h5 className="text-xs font-bold text-[var(--text-primary)] uppercase">Live Synchronization Workflow</h5>
                    <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                      As more runners register inside their terminal booth, simply open this browser, click <span className="text-amber-500 font-bold font-mono">Export CSV</span> again, overwrite your previous file in the same folder, and press <span className="text-[var(--text-primary)] font-bold font-mono bg-[var(--surface-inset)]/75 backdrop-blur-md px-1 py-0.5 rounded">Reload</span> inside LightBurn's Variable Text pane. The list updates instantly!
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer actions */}
            <div className="p-4 bg-[var(--surface-inset)]/75 backdrop-blur-md border-t border-[var(--border-subtle)] flex justify-between items-center">
              <span className="text-[10px] text-[var(--text-secondary)] font-mono tracking-wider">LOUD & CLEAR CUSTOM ENGRAVING APPARATUS</span>
              <button 
                onClick={handleDownloadCSV}
                className="bg-amber-500 hover:bg-amber-400 text-black font-extrabold uppercase text-[10px] py-1.5 px-4 rounded-[20px] tracking-wider transition-all flex items-center gap-1"
              >
                <FileDown className="w-3.5 h-3.5" /> Download Active CSV
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Change Passcode Modal */}
      {showPasscodeModal && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fadeIn transition-all">
          <div className="bg-[var(--surface-card)]/72 backdrop-blur-2xl border border-[var(--border-default)] rounded-[26px] w-full max-w-md overflow-hidden shadow-2xl flex flex-col">
            {/* Modal Header */}
            <div className="p-5 border-b border-[var(--border-subtle)] flex items-center justify-between bg-[var(--surface-inset)]/75 backdrop-blur-md">
              <div className="flex items-center gap-2">
                <Lock className="w-5 h-5 text-amber-500 animate-pulse" />
                <div>
                  <h2 className="heading-float text-md font-black tracking-tight font-display text-[var(--text-primary)] uppercase">Operator Passcode</h2>
                  <p className="text-[10px] text-[var(--text-secondary)] font-mono">STATION SECURITY CONTROL</p>
                </div>
              </div>
              <button 
                onClick={() => setShowPasscodeModal(false)}
                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition bg-[var(--surface-inset)]/75 backdrop-blur-md border border-[var(--border-default)] hover:border-[var(--border-default)] p-2 rounded-[20px] text-xs font-bold uppercase tracking-wider px-3"
              >
                ✕ Close
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSavePasscode} className="p-6 space-y-4">
              <div className="bg-[var(--surface-card)]/72 backdrop-blur-2xl p-3 rounded-[20px] border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)] leading-relaxed">
                <span className="text-[var(--text-secondary)] font-extrabold uppercase block mb-1">Current Passcode Status</span>
                The active passcode is currently <code className="text-amber-500 font-mono font-black">{currentPasscode}</code>. Set a new numerical or text passcode below to restrict dashboard access to authorized operators only.
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-extrabold text-[var(--text-secondary)] uppercase tracking-widest block font-mono">New Passcode</label>
                <input
                  type="password"
                  placeholder="Enter new dynamic passcode"
                  required
                  maxLength={10}
                  value={newPasscode}
                  onChange={(e) => setNewPasscode(e.target.value)}
                  className="w-full bg-[var(--surface-inset)]/75 backdrop-blur-md border border-[var(--border-subtle)] rounded-[20px] px-4 py-2.5 text-sm font-bold text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-extrabold text-[var(--text-secondary)] uppercase tracking-widest block font-mono">Confirm New Passcode</label>
                <input
                  type="password"
                  placeholder="Re-type brand new passcode"
                  required
                  maxLength={10}
                  value={passcodeConfirm}
                  onChange={(e) => setPasscodeConfirm(e.target.value)}
                  className="w-full bg-[var(--surface-inset)]/75 backdrop-blur-md border border-[var(--border-subtle)] rounded-[20px] px-4 py-2.5 text-sm font-bold text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>

              {passcodeError && (
                <div className="text-xs text-red-500 font-semibold p-2.5 bg-red-950/15 border border-red-900/30 rounded-[20px] text-center">
                  ⚠️ {passcodeError}
                </div>
              )}

              {passcodeSuccess && (
                <div className="text-xs text-green-500 font-semibold p-2.5 bg-green-950/15 border border-green-900/30 rounded-[20px] text-center animate-pulse">
                  ✅ Passcode updated successfully!
                </div>
              )}

              {/* Footer actions */}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowPasscodeModal(false)}
                  className="flex-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-default)] hover:bg-[var(--surface-inset)]/75 backdrop-blur-md font-bold py-2.5 rounded-[20px] transition uppercase tracking-wider"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={passcodeSuccess}
                  className="flex-1 text-xs text-black bg-amber-500 hover:bg-amber-400 disabled:bg-[var(--surface-hover)] disabled:text-[var(--text-secondary)] font-black py-2.5 rounded-[20px] shadow-lg transition uppercase tracking-wider"
                >
                  Save Passcode
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* QR SCANNER MODAL */}
      {showQrScanModal && (
        <QrScannerComponent
          onClose={() => setShowQrScanModal(false)}
          onScanSuccess={handleRegisterScannedOrder}
          successMessage={qrScanSuccessMessage}
          errorMessage={qrScanError}
        />
      )}

      {/* PDF REPORT GENERATOR MODAL */}
      {showPdfModal && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fadeIn transition-all">
          <div className="bg-[var(--surface-card)]/72 backdrop-blur-2xl border border-[var(--border-default)] rounded-[26px] w-full max-w-md overflow-hidden shadow-2xl flex flex-col">
            {/* Modal Header */}
            <div className="p-5 border-b border-[var(--border-subtle)] flex items-center justify-between bg-[var(--surface-inset)]/75 backdrop-blur-md">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-red-500/15 border border-red-500/30 rounded-[20px] text-red-400">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="heading-float text-md font-black tracking-tight font-display text-[var(--text-primary)] uppercase">Generate PDF Report</h2>
                  <p className="text-[11px] text-[var(--text-secondary)]">Export race finisher records and laser status</p>
                </div>
              </div>
              <button 
                onClick={() => setShowPdfModal(false)}
                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-1.5 rounded-lg hover:bg-[var(--surface-inset)]/75 backdrop-blur-md transition"
              >
                <BadgeMinus className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-5">
              <div>
                <label className="block text-xs font-bold font-display uppercase tracking-wider text-[var(--text-primary)] mb-2">
                  Race / Event Name
                </label>
                <input
                  type="text"
                  value={pdfRaceName}
                  onChange={(e) => setPdfRaceName(e.target.value)}
                  placeholder="e.g. Bukidnon 42K Ultra Run"
                  className="w-full bg-[var(--surface-inset)]/75 backdrop-blur-md border border-[var(--border-default)] rounded-[20px] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-red-400 focus:border-red-400 transition"
                />
                <p className="text-[10px] text-[var(--text-secondary)] mt-1.5">This title will be printed boldly at the top banner of the PDF document.</p>
              </div>

              <div>
                <label className="block text-xs font-bold font-display uppercase tracking-wider text-[var(--text-primary)] mb-2">
                  Filter Records to Include
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'all', label: 'All Orders', count: orders.length },
                    { id: 'completed', label: 'Completed Only', count: orders.filter(o => o.status === 'completed').length },
                    { id: 'queued', label: 'Queued (Pending)', count: orders.filter(o => o.status === 'queued').length },
                    { id: 'inprogress', label: 'In Progress', count: orders.filter(o => o.status === 'inprogress').length }
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setPdfReportFilter(item.id as any)}
                      className={`py-2.5 px-3 rounded-[20px] border text-left flex items-center justify-between transition ${
                        pdfReportFilter === item.id
                          ? 'bg-red-500/15 border-red-500 text-[var(--text-primary)] font-bold'
                          : 'bg-[var(--surface-inset)]/75 backdrop-blur-md border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-default)]'
                      }`}
                    >
                      <span className="text-xs">{item.label}</span>
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                        pdfReportFilter === item.id ? 'bg-red-500 text-black font-extrabold' : 'bg-[var(--surface-inset)]/75 backdrop-blur-md text-[var(--text-secondary)]'
                      }`}>
                        {item.count}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-5 border-t border-[var(--border-subtle)] bg-[var(--surface-inset)]/75 backdrop-blur-md flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowPdfModal(false)}
                className="px-4 py-2.5 rounded-[20px] text-xs font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-inset)]/75 backdrop-blur-md transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleGeneratePdfReport}
                className="px-5 py-2.5 rounded-[20px] text-xs font-extrabold bg-red-500 hover:bg-red-400 text-black uppercase tracking-wider flex items-center gap-2 shadow-lg shadow-red-500/20 transition active:scale-95"
              >
                <FileDown className="w-4 h-4" /> Download PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* OFFLINE BACKUP & SYNC MODAL */}
      {showBackupModal && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fadeIn transition-all">
          <div className="bg-[var(--surface-card)]/72 backdrop-blur-2xl border border-[var(--border-default)] rounded-[26px] w-full max-w-md overflow-hidden shadow-2xl flex flex-col">
            {/* Modal Header */}
            <div className="p-5 border-b border-[var(--border-subtle)] flex items-center justify-between bg-[var(--surface-inset)]/75 backdrop-blur-md">
              <div className="flex items-center gap-2">
                <DownloadCloud className="w-5 h-5 text-green-500" />
                <div>
                  <h2 className="heading-float text-md font-black tracking-tight font-display text-[var(--text-primary)] uppercase">Offline DB Sync</h2>
                  <p className="text-[10px] text-[var(--text-secondary)] font-mono">DUAL-LAPTOP OFFLINE OVER BRIDGE</p>
                </div>
              </div>
              <button 
                onClick={() => setShowBackupModal(false)}
                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition bg-[var(--surface-inset)]/75 backdrop-blur-md border border-[var(--border-default)] hover:border-[var(--border-default)] p-2 rounded-[20px] text-xs font-bold uppercase tracking-wider px-3"
              >
                ✕ Close
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-6">
              <div className="bg-[var(--surface-card)]/72 backdrop-blur-2xl p-3.5 rounded-[20px] border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)] leading-relaxed font-sans">
                <span className="text-green-500 font-extrabold uppercase block mb-1">Dual-Laptop Site Integration</span>
                When running completely offline on-site:
                <ol className="list-decimal pl-4 mt-1.5 space-y-1 text-[var(--text-secondary)]">
                  <li>Run the registration form on Laptop A.</li>
                  <li>At intervals, export the database from Laptop A or copy back-ups.</li>
                  <li>Transfer the `.json` backup file via a <strong>USB Flash Drive</strong> to Laptop B (Engraver Station).</li>
                  <li>Import the backup below to instantly synchronize.</li>
                </ol>
              </div>

              {/* Action 1: Export Current Queue */}
              <div className="space-y-2 p-4 bg-[var(--surface-inset)]/75 backdrop-blur-md border border-[var(--border-subtle)] rounded-[20px]">
                <h4 className="text-[10px] font-extrabold text-[var(--text-primary)] uppercase tracking-widest font-mono">1. Export Active Queue</h4>
                <p className="text-[10px] text-[var(--text-secondary)]">Download all registered active engraving orders as a backup JSON file.</p>
                <button
                  type="button"
                  onClick={handleExportOfflineBackup}
                  className="w-full flex items-center justify-center gap-1.5 text-xs text-black bg-green-500 hover:bg-green-400 font-black py-2.5 rounded-[20px] transition uppercase tracking-wider shadow"
                >
                  <DownloadCloud className="w-4 h-4" /> Export Queue Backup
                </button>
              </div>

              {/* Action 2: Import Backup JSON */}
              <div className="space-y-2.5 p-4 bg-[var(--surface-inset)]/75 backdrop-blur-md border border-[var(--border-subtle)] rounded-[20px]">
                <h4 className="text-[10px] font-extrabold text-[var(--text-primary)] uppercase tracking-widest font-mono">2. Import / Restore Queue</h4>
                <p className="text-[10px] text-[var(--text-secondary)]">Upload a `.json` backup file to merge offline entries into this laptop's local queue.</p>
                
                <input
                  type="file"
                  accept=".json"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleImportOfflineBackup(file);
                  }}
                  className="w-full text-xs text-[var(--text-secondary)] font-mono file:mr-3 file:py-2 file:px-4 file:rounded-[20px] file:border-0 file:text-[11px] file:font-bold file:bg-[var(--surface-inset)]/75 backdrop-blur-md file:text-[var(--text-primary)] hover:file:bg-[var(--surface-hover)]"
                />
              </div>

              {backupErrorMessage && (
                <div className="text-xs text-red-500 font-semibold p-2.5 bg-red-950/15 border border-red-900/30 rounded-[20px] text-center">
                  ⚠️ {backupErrorMessage}
                </div>
              )}

              {backupSuccessMessage && (
                <div className="text-xs text-green-500 font-semibold p-2.5 bg-green-950/15 border border-green-900/30 rounded-[20px] text-center animate-pulse">
                  ✅ {backupSuccessMessage}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* CUSTOM CONFIRM REGISTRATION DELETION MODAL */}
      {deleteConfirmOrder && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-[var(--surface-card)]/72 backdrop-blur-2xl border border-red-500/20 rounded-[26px] p-6 sm:p-8 max-w-md w-full text-center space-y-6 shadow-2xl relative animate-slideUp overflow-hidden">
            
            {/* Top red warning border gradient decoration */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-red-650 via-red-500 to-amber-500" />
            
            <div className="mx-auto w-14 h-14 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center shadow-lg shadow-red-500/5 animate-pulse">
              <Trash2 className="w-6 h-6 text-red-500" />
            </div>
            
            <div className="space-y-1">
              <h3 className="heading-float text-lg font-black font-display text-[var(--text-primary)] uppercase tracking-widest">Delete Registration?</h3>
              <p className="text-[11px] text-[var(--text-secondary)] font-medium">
                You are about to irreversibly remove this runner's engraving request.
              </p>
            </div>

            {/* Premium Interactive Ticket Mockup Summary */}
            <div className="bg-[var(--surface-inset)]/75 backdrop-blur-md border border-[var(--border-subtle)] rounded-[20px] p-4 text-left relative overflow-hidden shadow-inner space-y-3">
              <div className="absolute top-0 right-0 bottom-0 w-1 bg-red-500/40" />
              
              <div className="flex justify-between items-center text-[10px] font-mono font-bold">
                <span className="bg-[var(--surface-inset)]/75 backdrop-blur-md border border-[var(--border-default)] text-[var(--text-secondary)] px-2 py-0.5 rounded uppercase">
                  BIB #{deleteConfirmOrder.bibNumber || 'N/A'}
                </span>
                <span className="text-amber-500 font-black bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 rounded tracking-wider uppercase">
                  REF: {deleteConfirmOrder.id}
                </span>
              </div>

              <div className="space-y-1 pt-1">
                <span className="block text-[8px] uppercase font-extrabold text-[var(--text-secondary)] tracking-wider">Runner Name</span>
                <span className="text-sm font-bold text-[var(--text-primary)] tracking-tight block">
                  {deleteConfirmOrder.runnerName}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 border-t border-[var(--border-subtle)] pt-2.5">
                <div>
                  <span className="block text-[8px] uppercase font-extrabold text-[var(--text-secondary)] tracking-wider">Distance</span>
                  <span className="text-xs font-semibold text-[var(--text-primary)] block mt-0.5">
                    🎽 {deleteConfirmOrder.distance}
                  </span>
                </div>
                <div>
                  <span className="block text-[8px] uppercase font-extrabold text-[var(--text-secondary)] tracking-wider">Finish Time</span>
                  <span className="text-xs font-mono font-bold text-[var(--text-primary)] block mt-0.5">
                    ⏱️ {deleteConfirmOrder.finishingTime}
                  </span>
                </div>
              </div>

              {deleteConfirmOrder.customInscription && (
                <div className="border-t border-[var(--border-subtle)] pt-2">
                  <span className="block text-[8px] uppercase font-extrabold text-[var(--text-secondary)] tracking-wider">Engraving Inscription</span>
                  <span className="text-xs italic text-[var(--text-secondary)] block mt-1 bg-[var(--surface-inset)]/75 backdrop-blur-md border border-[var(--border-subtle)]/40 rounded px-2 py-1 truncate">
                    "{deleteConfirmOrder.customInscription}"
                  </span>
                </div>
              )}
            </div>

            <p className="text-[10px] text-red-500/90 font-bold bg-red-950/10 border border-red-950/40 rounded-lg p-2.5 leading-relaxed">
              ⚠️ Warning: Live tracker screen for this runner will immediately expire and be dismantled.
            </p>

            {/* Beautiful, responsive buttons with visual cues */}
            <div className="grid grid-cols-2 gap-3.5 pt-2">
              <button 
                onClick={() => setDeleteConfirmOrder(null)}
                className="w-full bg-[var(--surface-inset)]/75 backdrop-blur-md hover:bg-[var(--surface-hover)] text-[var(--text-primary)] font-extrabold py-3 px-4 rounded-[20px] text-[10px] uppercase tracking-widest border border-[var(--border-default)] transition duration-150 active:scale-95"
              >
                Abort & Keep
              </button>
              <button 
                onClick={handleExecuteDeleteOrder}
                className="w-full bg-gradient-to-r from-red-650 to-red-600 hover:brightness-110 text-white font-extrabold py-3 px-4 rounded-[20px] text-[10px] uppercase tracking-widest transition duration-150 active:scale-95 shadow-md shadow-red-950/20 flex items-center justify-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" /> Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CUSTOM PURGE DATABASE MODAL FOR FRESH START */}
      {showPurgeConfirm && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-[var(--surface-card)]/72 backdrop-blur-2xl border border-red-500/30 rounded-[26px] p-6 sm:p-8 max-w-md w-full text-center space-y-6 shadow-2xl relative animate-slideUp">
            <div className="mx-auto w-14 h-14 bg-red-500/15 text-red-500 rounded-full flex items-center justify-center animate-pulse">
              <AlertTriangle className="w-7 h-7 text-red-500" />
            </div>

            <div className="space-y-2">
              <h3 className="heading-float text-xl font-black text-[var(--text-primary)] uppercase tracking-tight font-display">Start Fresh Race?</h3>
              <p className="text-xs text-[var(--text-secondary)] leading-normal">
                This will instantly wipe out <strong className="text-[var(--text-primary)]">ALL {stats.total} engraving requests</strong> from both the cloud database and any local nodes. Use this to prepare a clean slate for the new race event!
              </p>
            </div>

            {/* Current Summary Statistics block */}
            <div className="bg-[var(--surface-inset)]/75 backdrop-blur-md rounded-[20px] p-4 border border-[var(--border-subtle)] text-left space-y-2 font-mono text-[11px] text-[var(--text-secondary)]">
              <span className="text-[9px] font-extrabold uppercase text-[var(--text-secondary)] block mb-1 tracking-widest font-sans">Data Purge Estimates:</span>
              <div className="flex justify-between border-b border-[var(--border-subtle)] pb-1.5">
                <span>Total Active Entries:</span>
                <span className="font-extrabold text-[var(--text-primary)]">{stats.total}</span>
              </div>
              <div className="flex justify-between border-b border-[var(--border-subtle)] pb-1.5">
                <span>Completed / Handover:</span>
                <span className="font-extrabold text-emerald-400">{stats.completed}</span>
              </div>
              <div className="flex justify-between text-[var(--text-secondary)]">
                <span>Discarded Pending Queue:</span>
                <span className="font-extrabold text-amber-500">{stats.queued + stats.inprogress + stats.ready}</span>
              </div>
            </div>

            <p className="text-[10px] text-red-500/80 font-bold border border-red-950/50 bg-red-950/10 p-2.5 rounded-lg text-center leading-relaxed">
              ⚠️ Warning: This action cannot be undone. Always ensure checking standard backups first!
            </p>

            <div className="grid grid-cols-2 gap-3.5 pt-2">
              <button 
                onClick={() => setShowPurgeConfirm(false)}
                className="w-full bg-[var(--surface-inset)]/75 backdrop-blur-md hover:bg-[var(--surface-hover)] text-[var(--text-primary)] font-bold py-3 px-4 rounded-[20px] text-xs uppercase tracking-wider border border-[var(--border-default)] transition active:scale-95"
              >
                Cancel, Keep DB
              </button>
              <button 
                onClick={handleExecutePurgeDatabase}
                className="w-full bg-gradient-to-r from-red-600 to-red-500 hover:brightness-110 text-white font-bold py-3 px-4 rounded-[20px] text-xs uppercase tracking-wider transition active:scale-95 shadow-md shadow-red-900/10"
              >
                Yes, Purge and Reset All
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// Self-contained high quality encapsulation of html5-qrcode implementation
interface QrScannerComponentProps {
  onClose: () => void;
  onScanSuccess: (text: string) => Promise<boolean>;
  successMessage: string;
  errorMessage: string;
}

function QrScannerComponent({
  onClose,
  onScanSuccess,
  successMessage,
  errorMessage
}: QrScannerComponentProps) {
  const scannerId = "html5-qr-scanner-element";
  const [cameraActive, setCameraActive] = useState(false);
  const [permissionError, setPermissionError] = useState(false);
  const [localFileError, setLocalFileError] = useState('');
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);

  useEffect(() => {
    let stopped = false;
    const startScanning = async () => {
      try {
        const html5QrCode = new Html5Qrcode(scannerId);
        html5QrCodeRef.current = html5QrCode;
        setCameraActive(true);
        setPermissionError(false);

        await html5QrCode.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: (width, height) => {
              const min = Math.min(width, height);
              return { width: Math.floor(min * 0.75), height: Math.floor(min * 0.75) };
            }
          },
          async (decodedText) => {
            if (stopped) return;
            await onScanSuccess(decodedText);
          },
          () => {
            // Silence verbose camera tracking errors in log console
          }
        );
      } catch (err: any) {
        console.error("Failed to start QR camera:", err);
        setCameraActive(false);
        const errMsg = err?.toString() || '';
        if (
          err?.name === "NotAllowedError" || 
          errMsg.includes("NotAllowedError") || 
          errMsg.includes("Permission denied") || 
          errMsg.includes("permission denied")
        ) {
          setPermissionError(true);
        }
      }
    };

    // Give DOM a tick to render element container
    const timer = setTimeout(() => {
      startScanning();
    }, 250);

    return () => {
      stopped = true;
      clearTimeout(timer);
      if (html5QrCodeRef.current) {
        if (html5QrCodeRef.current.isScanning) {
          html5QrCodeRef.current.stop().then(() => {
            html5QrCodeRef.current?.clear();
          }).catch(err => console.warn("Error stopping scanner component:", err));
        }
      }
    };
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLocalFileError('');

    try {
      const fileDecoder = new Html5Qrcode("temporary-file-qr-decoder");
      const text = await fileDecoder.scanFile(file, true);
      const success = await onScanSuccess(text);
      if (!success) {
        setLocalFileError("The QR code scanned is valid but matches an incompatible coupon format.");
      }
    } catch (err: any) {
      console.error("Manual QR photo decoder failed: ", err);
      setLocalFileError("Unable to detect QR code from this image. Please click closer or ensure clear lighting.");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fadeIn">
      {/* Hidden container for file decoder */}
      <div id="temporary-file-qr-decoder" className="hidden" />

      <div className="bg-[var(--surface-card)]/72 backdrop-blur-2xl border border-[var(--border-default)] rounded-[26px] w-full max-w-sm md:max-w-md overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-[var(--border-subtle)] flex items-center justify-between bg-[var(--surface-inset)]/75 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <Camera className="w-5 h-5 text-violet-500" />
            <div>
              <h2 className="heading-float text-md font-black tracking-tight font-display text-[var(--text-primary)] uppercase">Live Ticket QR Reader</h2>
              <p className="text-[10px] text-[var(--text-secondary)] font-mono">STANDBY FOR RUNNER TICKET TRANSIT</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition bg-[var(--surface-inset)]/75 backdrop-blur-md border border-[var(--border-default)] hover:border-[var(--border-default)] p-2 rounded-[20px] text-xs font-bold uppercase px-3"
          >
            ✕ Close
          </button>
        </div>

        {/* Body */}
        <div className="p-6 flex flex-col items-center justify-center space-y-4">
          <div className="text-center text-[11px] text-[var(--text-secondary)] max-w-sm bg-[var(--surface-card)]/72 backdrop-blur-2xl p-3 rounded-[20px] border border-[var(--border-subtle)] leading-relaxed font-sans">
            Point your webcam or laptop camera at the <strong>Offline Live QR Sync Ticket</strong> rendered on the runner's registration screen to transfer details offline immediately.
          </div>

          {/* Active Scanning Frame */}
          <div className="relative w-full aspect-square max-w-[280px] rounded-[26px] overflow-hidden border-2 border-dashed border-[var(--border-default)] bg-[var(--surface-inset)]/75 backdrop-blur-md flex items-center justify-center shadow-inner">
            <div id={scannerId} className="w-full h-full" />
            {!cameraActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-[var(--text-muted)] p-5 text-center bg-black/50 backdrop-blur-sm">
                <div className="relative mb-3 flex items-center justify-center w-12 h-12 bg-[var(--surface-inset)]/75 backdrop-blur-md rounded-full border border-[var(--border-default)]">
                  {permissionError ? (
                    <ShieldAlert className="w-6 h-6 text-red-500 animate-pulse" />
                  ) : (
                    <Camera className="w-6 h-6 text-[var(--text-muted)] animate-pulse" />
                  )}
                </div>
                {permissionError ? (
                  <div className="space-y-1.5">
                    <p className="text-xs font-mono font-black text-rose-500 tracking-wider">🚫 CAMERA ACCESS BLOCKED</p>
                    <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed">
                      Permission was denied. Please click the <strong className="text-[var(--text-primary)] bg-[var(--surface-hover)] px-1 py-0.5 rounded">Camera Icon/Lock</strong> in your browser's address bar to enable webcam access, or click "Upload QR Image" below to scan a photo of the QR ticket!
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-xs font-mono select-none">Awaiting Camera Feed...</p>
                    <p className="text-[10px] text-[var(--text-secondary)] mt-1 max-w-xs leading-normal">Please allow webcam access inside your browser when prompted.</p>
                  </div>
                )}
              </div>
            )}
            {cameraActive && (
              <div className="absolute top-3 left-3 bg-violet-600/15 border border-violet-500/20 text-violet-400 text-[9px] font-mono tracking-wider py-1 px-2.5 rounded-md uppercase font-bold animate-pulse">
                🎥 Scanner Active
              </div>
            )}
          </div>

          {/* Fallback Image Import Trigger */}
          <div className="w-full max-w-[280px]">
            <label className="flex flex-col items-center justify-center border border-dashed border-[var(--border-default)] hover:border-[var(--border-default)] bg-[var(--surface-card)]/72 backdrop-blur-2xl p-3 rounded-[20px] cursor-pointer transition select-none active:scale-95 duration-150">
              <span className="text-[10px] uppercase font-bold text-[var(--text-secondary)] flex items-center gap-1.5 font-mono">
                <UploadCloud className="w-3.5 h-3.5 text-amber-500" />
                Upload Photo / Screenshot of QR
              </span>
              <p className="text-[9px] text-[var(--text-muted)] mt-1">If webcam is unavailable or blocked</p>
              <input
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          </div>

          {/* Dynamic Alerts */}
          {successMessage && (
            <div className="w-full text-xs text-green-400 font-bold p-3 bg-green-955/15 border border-green-900/35 rounded-[20px] text-center animate-pulse">
              ✅ {successMessage}
            </div>
          )}

          {errorMessage && (
            <div className="w-full text-xs text-red-400 font-bold p-3 bg-red-955/15 border border-red-900/35 rounded-[20px] text-center">
              ⚠️ {errorMessage}
            </div>
          )}

          {localFileError && (
            <div className="w-full text-xs text-amber-500 font-bold p-3 bg-amber-955/15 border border-amber-900/35 rounded-[20px] text-center">
              ⚠️ {localFileError}
            </div>
          )}
        </div>

        {/* Footer instruction indicator */}
        <div className="p-4 bg-[var(--surface-inset)]/75 backdrop-blur-md border-t border-[var(--border-subtle)] flex justify-center items-center">
          <span className="text-[9.5px] text-[var(--text-secondary)] font-mono text-center tracking-normal leading-relaxed">
            Hint: You can import screenshots or camera pictures of QR codes directly!
          </span>
        </div>
      </div>
    </div>
  );
}

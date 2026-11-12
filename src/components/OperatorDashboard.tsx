import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  BarChart2,
  Bell,
  Calendar,
  Check,
  CheckCircle2,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Clock,
  Coins,
  Copy,
  Cpu,
  DownloadCloud,
  FileDown,
  FileText,
  Flag,
  HelpCircle,
  ListOrdered,
  Play,
  Printer,
  QrCode,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  Users,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import { authenticatedFetch, useAccess, useScopedRaces } from '../lib/access';
import { startLanJsonPoller } from '../lib/lanBridge';
import { formatDateTime, formatRaceTime } from '../lib/preciseTime';
import { useWorkspaceHeader } from '../lib/workspaceHeader';
import { EngravingOrder, EngravingStats, EngravingStatus, RunnerProfile } from '../types';
import QrScannerModal from './QrScannerModal';
import DialogSurface from './ui/DialogSurface';
import { useFeedback } from './ui/FeedbackProvider';
import { AnimatedMetricValue, ValueSkeleton } from './ui/MotionPrimitives';

type MasterView = 'queue' | 'roster';

const DESKTOP_QUERY = '(min-width: 1024px)';

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia(DESKTOP_QUERY).matches : true,
  );

  useEffect(() => {
    const media = window.matchMedia(DESKTOP_QUERY);
    const update = () => setIsDesktop(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return isDesktop;
}

const STATUS_META: Record<
  EngravingStatus,
  { label: string; shortLabel: string; badgeClass: string; rowAccent: string }
> = {
  queued: {
    label: 'Queued',
    shortLabel: 'Queued',
    badgeClass:
      'bg-yellow-100 text-yellow-900 border-yellow-400 dark:bg-yellow-950/60 dark:text-yellow-300 dark:border-yellow-700',
    rowAccent: 'border-l-yellow-600 dark:border-l-yellow-500',
  },
  inprogress: {
    label: 'Engraving',
    shortLabel: 'Engraving',
    badgeClass:
      'bg-red-100 text-red-800 border-red-400 dark:bg-red-950/60 dark:text-red-300 dark:border-red-700',
    rowAccent: 'border-l-red-600 dark:border-l-red-500',
  },
  ready: {
    label: 'Ready',
    shortLabel: 'Ready',
    badgeClass:
      'bg-blue-100 text-blue-900 border-blue-400 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-700',
    rowAccent: 'border-l-blue-600 dark:border-l-blue-500',
  },
  completed: {
    label: 'Completed',
    shortLabel: 'Done',
    badgeClass:
      'bg-emerald-100 text-emerald-900 border-emerald-400 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-700',
    rowAccent: 'border-l-emerald-600 dark:border-l-emerald-500',
  },
};

function StatusIcon({ status }: { status: EngravingStatus }) {
  switch (status) {
    case 'queued':
      return <Clock className="w-3 h-3 shrink-0" aria-hidden="true" />;
    case 'inprogress':
      return <Play className="w-3 h-3 shrink-0" aria-hidden="true" />;
    case 'ready':
      return <CheckCircle2 className="w-3 h-3 shrink-0" aria-hidden="true" />;
    case 'completed':
      return <CheckSquare className="w-3 h-3 shrink-0" aria-hidden="true" />;
  }
}

export interface EngravingLaunchRequest {
  raceId: string;
  nonce: number;
}

interface OperatorDashboardProps {
  launchRequest?: EngravingLaunchRequest | null;
}

export default function OperatorDashboard({ launchRequest }: OperatorDashboardProps = {}) {
  const { can, authority } = useAccess();
  const races = useScopedRaces();
  const { confirm, notify } = useFeedback();
  const headerCtx = useWorkspaceHeader();
  const isDesktop = useIsDesktop();

  const [orders, setOrders] = useState<EngravingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [selectedRaceId, setSelectedRaceId] = useState(
    () => launchRequest?.raceId || localStorage.getItem('racepulse_engraving_race') || '',
  );
  useEffect(() => {
    if (!launchRequest?.raceId) return;
    localStorage.setItem('racepulse_engraving_race', launchRequest.raceId);
    setSelectedRaceId(launchRequest.raceId);
    setRunnerSearch('');
  }, [launchRequest?.nonce, launchRequest?.raceId]);
  const [eventRunners, setEventRunners] = useState<RunnerProfile[]>([]);
  const [eventRunnersLoading, setEventRunnersLoading] = useState(false);
  const [eventRunnersError, setEventRunnersError] = useState<string | null>(null);
  const [runnerSearch, setRunnerSearch] = useState('');
  const [masterView, setMasterView] = useState<MasterView>('queue');

  // Filtering and Searching State
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | EngravingStatus>('all');

  // Double-Check helper input & active detail selection
  const [doubleCheckCode, setDoubleCheckCode] = useState('');

  // State for showing copy check mark feedback per-field
  const [copiedStates, setCopiedStates] = useState<Record<string, boolean>>({});

  // Sound & Header Config Popover
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [newOrderAlert, setNewOrderAlert] = useState<string | null>(null);
  const [showConfigPopover, setShowConfigPopover] = useState(false);
  const [showLightBurnModal, setShowLightBurnModal] = useState(false);

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
  const [pdfReportFilter, setPdfReportFilter] = useState<
    'all' | 'completed' | 'queued' | 'inprogress' | 'ready'
  >('all');

  // Dual Offline LAN + Firestore sync state
  const [lanConnected, setLanConnected] = useState<boolean | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [pricePerMedal, setPricePerMedal] = useState<number>(() => {
    const saved = localStorage.getItem('price_per_medal');
    const parsed = saved ? parseFloat(saved) : 150;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 150;
  });

  const handlePriceChange = (val: number) => {
    const safe = Number.isFinite(val) && val >= 0 ? val : 0;
    setPricePerMedal(safe);
    localStorage.setItem('price_per_medal', safe.toString());
  };

  const [deleteConfirmOrder, setDeleteConfirmOrder] = useState<EngravingOrder | null>(null);
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false);

  const firestoreOrdersRef = useRef<EngravingOrder[]>([]);
  const localOrdersRef = useRef<EngravingOrder[]>([]);
  const prevCountRef = useRef<number>(0);
  const ordersRef = useRef<EngravingOrder[]>([]);
  ordersRef.current = orders;
  const soundEnabledRef = useRef<boolean>(soundEnabled);
  soundEnabledRef.current = soundEnabled;

  const queueSearchRef = useRef<HTMLInputElement>(null);
  const doubleCheckInputRef = useRef<HTMLInputElement>(null);
  const configPopoverRef = useRef<HTMLDivElement>(null);

  // Coordinate desktop viewport lock with App shell & WorkspaceShell
  const setDesktopLocked = headerCtx?.setDesktopLocked;
  useEffect(() => {
    if (!setDesktopLocked) return;
    setDesktopLocked(isDesktop);
    return () => setDesktopLocked(false);
  }, [isDesktop, setDesktopLocked]);

  // Network online/offline reactivity
  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // Close pricing/station config popover on Escape or outside click
  useEffect(() => {
    if (!showConfigPopover) return;
    const onPointerDown = (event: PointerEvent) => {
      if (configPopoverRef.current && !configPopoverRef.current.contains(event.target as Node)) {
        setShowConfigPopover(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowConfigPopover(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [showConfigPopover]);

  const triggerBeepSound = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.value = 880;
      gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.3);
    } catch {
      // Browser autoplay policy may block audio before user gesture.
    }
  };

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

    firestoreOrdersRef.current.forEach(insertOrResolve);
    localOrdersRef.current.forEach(insertOrResolve);

    const mergedList = Array.from(combinedMap.values());

    // Sort active laser work first, then queued, then ready, then completed
    mergedList.sort((a, b) => {
      const orderWeight: Record<EngravingStatus, number> = {
        inprogress: 1,
        queued: 2,
        ready: 3,
        completed: 4,
      };
      const weightA = orderWeight[a.status] || 99;
      const weightB = orderWeight[b.status] || 99;

      if (weightA !== weightB) return weightA - weightB;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    if (mergedList.length > prevCountRef.current && prevCountRef.current > 0) {
      const newlyAdded = mergedList.find((o) => !ordersRef.current.some((exist) => exist.id === o.id));
      if (newlyAdded) {
        setNewOrderAlert(`New order queued: ${newlyAdded.runnerName} (Code ${newlyAdded.id})`);
        window.setTimeout(() => setNewOrderAlert(null), 5000);
        if (soundEnabledRef.current) triggerBeepSound();
      }
    }

    setOrders(mergedList);
    prevCountRef.current = mergedList.length;
    setLoading(false);
  };

  // 1. Firestore Cloud Database Listener
  useEffect(() => {
    const q = query(collection(db, 'orders'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const ordersList: EngravingOrder[] = [];
        snapshot.forEach((docSnap) => {
          ordersList.push(docSnap.data() as EngravingOrder);
        });
        firestoreOrdersRef.current = ordersList;
        setOrdersError(null);
        mergeAndPublish();
      },
      (error) => {
        console.warn('Cloud Firestore stream offline or restricted:', error.message);
        if (localOrdersRef.current.length === 0) {
          setOrdersError('Cloud sync unavailable. Waiting for local LAN queue or reconnect.');
        }
        setLoading(false);
      },
    );
    return () => unsubscribe();
  }, []);

  // Event-scoped registration roster listener
  useEffect(() => {
    localStorage.setItem('racepulse_engraving_race', selectedRaceId);
    if (!selectedRaceId) {
      setEventRunners([]);
      setEventRunnersLoading(false);
      setEventRunnersError(null);
      return;
    }
    setEventRunnersLoading(true);
    setEventRunnersError(null);
    const unsubscribe = onSnapshot(
      query(collection(db, 'runners'), where('raceId', '==', selectedRaceId)),
      (snapshot) => {
        const runners = snapshot.docs
          .map((runnerDoc) => runnerDoc.data() as RunnerProfile)
          .sort((a, b) => a.bibNumber.localeCompare(b.bibNumber, undefined, { numeric: true }));
        setEventRunners(runners);
        setEventRunnersLoading(false);
      },
      (error) => {
        console.warn('Engraving event roster listener failed:', error.message);
        setEventRunners([]);
        setEventRunnersLoading(false);
        setEventRunnersError('Could not load event roster. Check network connection or permissions.');
      },
    );
    return () => unsubscribe();
  }, [selectedRaceId]);

  // 2. Local Express LAN Server Sync
  useEffect(() => {
    return startLanJsonPoller({
      endpoint: '/api/orders',
      fetcher: authenticatedFetch,
      activeIntervalMs: 2000,
      onData: (payload) => {
        const record = (payload && typeof payload === 'object') ? (payload as { orders?: EngravingOrder[] }) : {};
        setLanConnected(true);
        setOrdersError(null);
        localOrdersRef.current = record.orders || [];
        mergeAndPublish();
      },
      onDisconnected: () => setLanConnected(false),
    });
  }, []);

  // Stats calculation
  const stats: EngravingStats = useMemo(
    () =>
      orders.reduce(
        (acc, order) => {
          acc.total += 1;
          acc[order.status] += 1;
          const dist = order.distance || 'Other';
          acc.byDistance[dist] = (acc.byDistance[dist] || 0) + 1;
          return acc;
        },
        {
          total: 0,
          queued: 0,
          inprogress: 0,
          ready: 0,
          completed: 0,
          byDistance: {} as Record<string, number>,
        },
      ),
    [orders],
  );

  // Action: Update Order Status
  const handleUpdateStatus = async (orderId: string, nextStatus: EngravingStatus) => {
    const timestamp = new Date().toISOString();

    try {
      await updateDoc(doc(db, 'orders', orderId), {
        status: nextStatus,
        updatedAt: timestamp,
      });
    } catch (e) {
      console.warn('Cloud Firestore update deferred or offline:', e);
    }

    try {
      const existingOrder = orders.find((o) => o.id === orderId);
      if (existingOrder) {
        await authenticatedFetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...existingOrder, status: nextStatus, updatedAt: timestamp }),
        });
      }
    } catch (laneErr) {
      console.warn('LAN status sync skipped:', laneErr);
    }
  };

  // Action: Trigger Confirmation Deletion
  const handleDeleteOrder = (orderId: string, runner: string) => {
    const found = orders.find((o) => o.id === orderId);
    if (found) {
      setDeleteConfirmOrder(found);
    } else {
      const now = new Date().toISOString();
      setDeleteConfirmOrder({
        id: orderId,
        runnerName: runner,
        bibNumber: 'N/A',
        distance: 'Unknown',
        finishingTime: '00:00:0000000',
        status: 'queued',
        createdAt: now,
        updatedAt: now,
      });
    }
  };

  // Action: Perform Single Order Deletion
  const handleExecuteDeleteOrder = async () => {
    if (!deleteConfirmOrder) return;
    const { id: orderId } = deleteConfirmOrder;
    setDeleteConfirmOrder(null);
    if (doubleCheckCode.toUpperCase() === orderId.toUpperCase()) {
      setDoubleCheckCode('');
    }

    try {
      await deleteDoc(doc(db, 'orders', orderId));
    } catch (e) {
      console.warn('Cloud Firestore delete offline or deferred:', e);
    }

    try {
      await authenticatedFetch(`/api/orders/${orderId}`, { method: 'DELETE' });
    } catch (laneErr) {
      console.warn('LAN delete sync skipped:', laneErr);
    }
  };

  const handlePurgeDatabase = () => {
    setShowConfigPopover(false);
    setShowPurgeConfirm(true);
  };

  const handleExecutePurgeDatabase = async () => {
    setShowPurgeConfirm(false);
    setDoubleCheckCode('');
    try {
      setLoading(true);
      const snapshot = await getDocs(query(collection(db, 'orders')));
      const batch = writeBatch(db);
      snapshot.forEach((docSnap) => batch.delete(docSnap.ref));
      await batch.commit();
    } catch (e) {
      console.warn('Cloud database purge skipped/offline:', e);
    }

    try {
      await authenticatedFetch('/api/orders/reset', { method: 'POST' });
    } catch (laneErr) {
      console.warn('LAN purge sync skipped:', laneErr);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadCSV = () => {
    if (orders.length === 0) {
      notify({
        tone: 'info',
        title: 'No active orders to export',
        message: 'Scan a runner ticket or wait for queue submissions before exporting a LightBurn CSV.',
      });
      return;
    }

    const orderPriority: Record<EngravingStatus, number> = {
      queued: 0,
      inprogress: 1,
      ready: 2,
      completed: 3,
    };
    const sortedOrders = [...orders].sort(
      (a, b) => orderPriority[a.status] - orderPriority[b.status],
    );

    const headers = [
      'Index',
      'RefCode',
      'RunnerName',
      'BibNumber',
      'FinishingTime',
      'Distance',
      'Rank',
      'CustomInscription',
      'Status',
    ];

    const rows = sortedOrders.map((order, idx) => [
      idx + 1,
      order.id,
      `"${order.runnerName.replace(/"/g, '""')}"`,
      `"${order.bibNumber.replace(/"/g, '""')}"`,
      `"${formatRaceTime(order.finishingTime).replace(/"/g, '""')}"`,
      `"${order.distance.replace(/"/g, '""')}"`,
      `"${(order.rank || '').replace(/"/g, '""')}"`,
      `"${(order.customInscription || '').replace(/"/g, '""')}"`,
      order.status,
    ]);

    const csvContent = [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'racepulse_lightburn_sync.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    notify({
      tone: 'success',
      title: 'CSV exported',
      message: `Saved ${sortedOrders.length} orders to racepulse_lightburn_sync.csv.`,
    });
  };

  const handleGeneratePdfReport = async () => {
    const ordersToExport =
      pdfReportFilter === 'all' ? orders : orders.filter((o) => o.status === pdfReportFilter);

    if (ordersToExport.length === 0) {
      notify({
        tone: 'info',
        title: 'No matching orders',
        message: 'Choose a different status filter or wait for orders before generating a PDF.',
      });
      return;
    }

    const [{ jsPDF }, { default: autoTable }] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ]);
    const pdfDoc = new jsPDF({ orientation: 'landscape' });

    pdfDoc.setFillColor(20, 20, 22);
    pdfDoc.rect(0, 0, 297, 30, 'F');

    pdfDoc.setTextColor(255, 255, 255);
    pdfDoc.setFontSize(18);
    pdfDoc.setFont('helvetica', 'bold');
    pdfDoc.text(pdfRaceName.toUpperCase() || 'RACE MEDAL ENGRAVING REPORT', 14, 15);

    pdfDoc.setFontSize(10);
    pdfDoc.setTextColor(255, 98, 89);
    const dateStr = formatDateTime(new Date());
    pdfDoc.text(
      `Generated: ${dateStr}   |   Total Athletes: ${ordersToExport.length}   |   Status Filter: ${pdfReportFilter.toUpperCase()}`,
      14,
      24,
    );

    const tableRows = ordersToExport.map((o, index) => [
      index + 1,
      o.bibNumber,
      o.runnerName,
      o.distance,
      formatRaceTime(o.finishingTime),
      o.rank || '-',
      o.customInscription || '-',
      o.status.toUpperCase(),
    ]);

    autoTable(pdfDoc, {
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
        7: { cellWidth: 30 },
      },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 7) {
          const val = data.cell.raw as string;
          if (val === 'COMPLETED') {
            data.cell.styles.textColor = [16, 185, 129];
            data.cell.styles.fontStyle = 'bold';
          } else if (val === 'INPROGRESS') {
            data.cell.styles.textColor = [224, 54, 44];
            data.cell.styles.fontStyle = 'bold';
          } else if (val === 'QUEUED') {
            data.cell.styles.textColor = [180, 83, 9];
          }
        }
      },
    });

    const sanitizedFileName = (pdfRaceName.trim() || 'Race_Report').replace(/[^a-zA-Z0-9_-]/g, '_');
    pdfDoc.save(`${sanitizedFileName}_Medals_Report.pdf`);
    setShowPdfModal(false);
    notify({
      tone: 'success',
      title: 'PDF report downloaded',
      message: `Exported ${ordersToExport.length} athlete records.`,
    });
  };

  const handleCopyText = (key: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopiedStates((prev) => ({ ...prev, [key]: true }));
    window.setTimeout(() => {
      setCopiedStates((prev) => ({ ...prev, [key]: false }));
    }, 1500);
  };

  const handleCopyTSVRow = (order: EngravingOrder) => {
    const row = [
      order.runnerName,
      order.bibNumber,
      order.distance,
      formatRaceTime(order.finishingTime),
      order.rank || '',
      order.customInscription || '',
    ].join('\t');
    handleCopyText(`${order.id}_tsv_all`, row);
  };

  const handleRegisterScannedOrder = async (qrDataText: string) => {
    setQrScanError('');
    setQrScanSuccessMessage('');
    try {
      let parsedOrder: Partial<EngravingOrder> = {};

      if (qrDataText.startsWith('RXPv2|') || qrDataText.includes('|')) {
        const parts = qrDataText.split('|');
        if (parts.length >= 4) {
          parsedOrder = {
            id: parts[1],
            runnerName: parts[2],
            bibNumber: parts[3],
            distance: parts[4] || 'Marathon',
            finishingTime: formatRaceTime(parts[5] || '00:00:0000000'),
            rank: parts[6] || '',
            customInscription: parts[7] || '',
            status: 'queued',
          };
        } else {
          throw new Error('Invalid or abbreviated pipe QR Sync format.');
        }
      } else {
        const data = JSON.parse(qrDataText);
        if (!data.id || !data.rn || !data.bn) {
          throw new Error('Invalid or incompatible QR Sync Ticket format.');
        }
        parsedOrder = {
          id: data.id,
          runnerName: data.rn,
          bibNumber: data.bn,
          distance: data.ds || 'Marathon',
          finishingTime: formatRaceTime(data.ft || '00:00:0000000'),
          rank: data.rk || '',
          customInscription: data.ci || '',
          status: data.st || 'queued',
        };
      }

      if (!parsedOrder.id || !parsedOrder.runnerName || !parsedOrder.bibNumber) {
        throw new Error('Missing critical runner details in QR code.');
      }

      const timestamp = new Date().toISOString();
      const scannedOrder: EngravingOrder = {
        id: parsedOrder.id,
        runnerName: parsedOrder.runnerName,
        bibNumber: parsedOrder.bibNumber,
        distance: parsedOrder.distance || 'Marathon',
        finishingTime: formatRaceTime(parsedOrder.finishingTime || '00:00:0000000'),
        rank: parsedOrder.rank || '',
        customInscription: parsedOrder.customInscription || '',
        status: parsedOrder.status || 'queued',
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      const exists = orders.some((o) => o.id === scannedOrder.id);
      let targetId = scannedOrder.id;
      if (exists) {
        const confirmOverwrite = await confirm({
          title: `Duplicate code ${targetId}`,
          message: `Order "${targetId}" (${scannedOrder.runnerName}) is already in the queue. Overwrite the existing record, or add it as a separate suffixed entry?`,
          confirmLabel: 'Overwrite existing',
          cancelLabel: 'Add separate entry',
        });
        if (!confirmOverwrite) {
          targetId = `${scannedOrder.id}-${Math.floor(100 + Math.random() * 900)}`;
          scannedOrder.id = targetId;
        }
      }

      await setDoc(doc(db, 'orders', targetId), scannedOrder);
      triggerBeepSound();
      setDoubleCheckCode(targetId);
      setQrScanSuccessMessage(`Loaded ticket #${targetId} for "${scannedOrder.runnerName}" into queue.`);
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to parse coupon details.';
      setQrScanError(msg);
      return false;
    }
  };

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
      setBackupSuccessMessage('Backup exported to downloads.');
    } catch (err: unknown) {
      setBackupErrorMessage(err instanceof Error ? err.message : 'Error occurred during export.');
    }
  };

  const handleImportOfflineBackup = async (file: File) => {
    setBackupSuccessMessage('');
    setBackupErrorMessage('');
    try {
      const text = await file.text();
      const imported = JSON.parse(text);
      if (!Array.isArray(imported)) {
        throw new Error('Invalid file content. Expected an array of engraving orders.');
      }

      let count = 0;
      for (const item of imported) {
        if (!item.id || !item.runnerName || !item.bibNumber) continue;
        await setDoc(doc(db, 'orders', item.id), {
          ...item,
          status: item.status || 'queued',
          createdAt: item.createdAt || new Date().toISOString(),
          updatedAt: item.updatedAt || new Date().toISOString(),
        });
        count++;
      }

      triggerBeepSound();
      setBackupSuccessMessage(`Imported and synchronized ${count} orders from JSON.`);
    } catch (err: unknown) {
      setBackupErrorMessage(err instanceof Error ? err.message : 'Failed to load backup file.');
    }
  };

  const filteredOrders = useMemo(
    () =>
      orders.filter((o) => {
        const needle = searchTerm.toLowerCase();
        const matchSearch =
          o.id.toLowerCase().includes(needle) ||
          o.runnerName.toLowerCase().includes(needle) ||
          o.bibNumber.toLowerCase().includes(needle);
        const matchStatus = statusFilter === 'all' ? true : o.status === statusFilter;
        return matchSearch && matchStatus;
      }),
    [orders, searchTerm, statusFilter],
  );

  const selectedRace = races.find((race) => race.id === selectedRaceId);
  const filteredEventRunners = useMemo(
    () =>
      eventRunners.filter((runner) => {
        const needle = runnerSearch.trim().toLowerCase();
        if (!needle) return true;
        return (
          runner.fullName.toLowerCase().includes(needle) ||
          runner.bibNumber.toLowerCase().includes(needle) ||
          runner.distance.toLowerCase().includes(needle)
        );
      }),
    [eventRunners, runnerSearch],
  );

  const sortedRaces = useMemo(
    () => [...races].sort((a, b) => b.date.localeCompare(a.date)),
    [races],
  );

  const foundDoubleCheckOrder = doubleCheckCode.trim()
    ? orders.find((o) => o.id.toUpperCase() === doubleCheckCode.trim().toUpperCase())
    : null;

  const activeOrderIndex = foundDoubleCheckOrder
    ? filteredOrders.findIndex((o) => o.id === foundDoubleCheckOrder.id)
    : -1;

  const stepActiveOrder = (delta: -1 | 1) => {
    if (filteredOrders.length === 0) return;
    if (activeOrderIndex === -1) {
      setDoubleCheckCode(filteredOrders[0].id);
      return;
    }
    const nextIdx = (activeOrderIndex + delta + filteredOrders.length) % filteredOrders.length;
    setDoubleCheckCode(filteredOrders[nextIdx].id);
  };

  const openQrModal = () => {
    setQrScanError('');
    setQrScanSuccessMessage('');
    setShowQrScanModal(true);
  };

  const openPdfModal = () => {
    if (selectedRace?.name) {
      setPdfRaceName(selectedRace.name);
    }
    setShowPdfModal(true);
  };

  const openBackupModal = () => {
    setBackupSuccessMessage('');
    setBackupErrorMessage('');
    setShowBackupModal(true);
  };

  const toggleBuzzer = () => {
    setSoundEnabled((prev) => !prev);
    triggerBeepSound();
  };

  // Single-key desktop command shortcuts (active only when not typing in a field or modal)
  useEffect(() => {
    const anyModalOpen =
      showQrScanModal ||
      showPdfModal ||
      showBackupModal ||
      showLightBurnModal ||
      Boolean(deleteConfirmOrder) ||
      showPurgeConfirm;

    const onKeyDown = (event: KeyboardEvent) => {
      if (anyModalOpen || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 'q') {
        event.preventDefault();
        openQrModal();
      } else if (key === 'e' && can('engraving.export')) {
        event.preventDefault();
        handleDownloadCSV();
      } else if (key === 'p' && can('engraving.export')) {
        event.preventDefault();
        openPdfModal();
      } else if (key === 'b') {
        event.preventDefault();
        toggleBuzzer();
      } else if (key === 'o' && can('engraving.backup')) {
        event.preventDefault();
        openBackupModal();
      } else if (key === '/') {
        event.preventDefault();
        queueSearchRef.current?.focus();
      } else if (key === 'd') {
        event.preventDefault();
        doubleCheckInputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // Desktop Header Left Context Switcher (Portaled next to RACEPULSEPH logo in App.tsx)
  const headerLeftMarkup = (
    <div className="flex items-center gap-2.5 min-w-0 flex-1">
      <span className="h-5 w-px bg-white/15 shrink-0" aria-hidden="true" />
      <div className="flex items-center gap-2 min-w-0">
        <Calendar className="w-3.5 h-3.5 text-red-400 shrink-0" aria-hidden="true" />
        <label htmlFor="header_event_select" className="sr-only">
          Active race event for engraving
        </label>
        <select
          id="header_event_select"
          value={selectedRaceId}
          onChange={(event) => {
            setSelectedRaceId(event.target.value);
            setRunnerSearch('');
          }}
          className="h-9 min-w-[160px] max-w-[210px] xl:max-w-[300px] rounded-lg border border-white/15 bg-white/10 px-2.5 text-xs font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 truncate"
        >
          <option value="" className="bg-[#141416] text-white">
            All Events (Global Queue)
          </option>
          {sortedRaces.map((race) => (
            <option key={race.id} value={race.id} className="bg-[#141416] text-white">
              {race.name} ({race.date})
            </option>
          ))}
        </select>
        {selectedRaceId && (
          <button
            type="button"
            onClick={() => setMasterView((prev) => (prev === 'roster' ? 'queue' : 'roster'))}
            aria-pressed={masterView === 'roster'}
            title={masterView === 'roster' ? 'Return to engraving queue' : 'View selected race roster'}
            className={`hidden xl:inline-flex items-center gap-1.5 h-9 px-2.5 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap ${
              masterView === 'roster'
                ? 'bg-red-700 text-white border-red-500/40'
                : 'bg-white/10 text-zinc-200 border-white/15 hover:bg-white/15 hover:text-white'
            }`}
          >
            <Users className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Roster: {eventRunners.length}</span>
          </button>
        )}
      </div>

      {/* Static telemetry link status (no pulsing loops) */}
      <div
        className="hidden xl:flex items-center gap-2 px-2.5 h-8 rounded-lg border border-white/10 bg-white/5 text-[11px] font-mono text-zinc-200 shrink-0"
        title={
          isOnline
            ? lanConnected
              ? 'Cloud Firestore and local LAN co-processing active'
              : 'Cloud Firestore active'
            : 'Offline local sync mode'
        }
      >
        {isOnline ? (
          <Wifi className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
        ) : (
          <WifiOff className="w-3.5 h-3.5 text-red-400" aria-hidden="true" />
        )}
        <span>{isOnline ? 'ONLINE' : 'OFFLINE'}</span>
        {lanConnected && (
          <span className="border-l border-white/15 pl-2 text-emerald-300">LAN</span>
        )}
      </div>
    </div>
  );

  // Desktop Header Right Action Cluster (Portaled beside Theme Toggle in App.tsx)
  const headerRightMarkup = (
    <div className="flex items-center gap-1.5" role="toolbar" aria-label="Engraving command actions">
      <button
        type="button"
        onClick={openQrModal}
        title="Scan runner QR ticket (Shortcut: Q)"
        className="h-9 px-2.5 xl:px-3 rounded-lg bg-red-700 hover:bg-red-600 text-white border border-red-500/30 text-xs font-semibold flex items-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 whitespace-nowrap"
      >
        <QrCode className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>Scan QR</span>
        <kbd className="hidden xl:inline-flex items-center justify-center px-1.5 h-4 text-[10px] font-mono bg-black/30 rounded border border-white/20 text-white/90">
          Q
        </kbd>
      </button>

      <button
        type="button"
        hidden={!can('engraving.export')}
        onClick={handleDownloadCSV}
        title="Export LightBurn Variable-Text CSV (Shortcut: E)"
        className="h-9 px-2.5 rounded-lg border border-white/15 bg-white/10 hover:bg-white/15 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 whitespace-nowrap"
      >
        <FileDown className="w-3.5 h-3.5 text-zinc-200 shrink-0" aria-hidden="true" />
        <span>CSV</span>
        <kbd className="hidden xl:inline-flex items-center justify-center px-1.5 h-4 text-[10px] font-mono bg-black/30 rounded border border-white/15 text-zinc-200">
          E
        </kbd>
      </button>

      <button
        type="button"
        hidden={!can('engraving.export')}
        onClick={openPdfModal}
        title="Generate PDF report (Shortcut: P)"
        className="h-9 px-2.5 rounded-lg border border-white/15 bg-white/10 hover:bg-white/15 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 whitespace-nowrap"
      >
        <FileText className="w-3.5 h-3.5 text-red-400 shrink-0" aria-hidden="true" />
        <span>PDF</span>
        <kbd className="hidden xl:inline-flex items-center justify-center px-1.5 h-4 text-[10px] font-mono bg-black/30 rounded border border-white/15 text-zinc-200">
          P
        </kbd>
      </button>

      <button
        type="button"
        onClick={toggleBuzzer}
        aria-pressed={soundEnabled}
        title="Toggle new-order buzzer sound (Shortcut: B)"
        className={`h-9 px-2.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 whitespace-nowrap ${
          soundEnabled
            ? 'bg-emerald-700/80 border-emerald-500/40 text-white'
            : 'bg-white/10 border-white/15 text-zinc-200 hover:bg-white/15 hover:text-white'
        }`}
      >
        {soundEnabled ? (
          <Volume2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <VolumeX className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        )}
        <span className="hidden xl:inline">{soundEnabled ? 'Buzzer On' : 'Buzzer'}</span>
        <kbd className="hidden xl:inline-flex items-center justify-center px-1.5 h-4 text-[10px] font-mono bg-black/30 rounded border border-white/15 text-zinc-200">
          B
        </kbd>
      </button>

      <button
        type="button"
        hidden={!can('engraving.backup')}
        onClick={openBackupModal}
        title="Offline JSON backup & dual-laptop sync (Shortcut: O)"
        className="h-9 px-2.5 rounded-lg border border-white/15 bg-white/10 hover:bg-white/15 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 whitespace-nowrap"
      >
        <DownloadCloud className="w-3.5 h-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
        <span className="hidden xl:inline">Offline</span>
        <kbd className="hidden xl:inline-flex items-center justify-center px-1.5 h-4 text-[10px] font-mono bg-black/30 rounded border border-white/15 text-zinc-200">
          O
        </kbd>
      </button>

      {/* Setup Pricing & Station Settings Config Popover (ISO 11064-5: separates editable config from read-only telemetry) */}
      <div ref={configPopoverRef} className="relative">
        <button
          type="button"
          onClick={() => setShowConfigPopover((prev) => !prev)}
          aria-expanded={showConfigPopover}
          aria-haspopup="dialog"
          title="Station configuration and medal pricing"
          className={`h-9 px-2.5 rounded-lg border text-xs font-semibold font-mono flex items-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 whitespace-nowrap ${
            showConfigPopover
              ? 'bg-white/20 border-white/30 text-white'
              : 'bg-white/10 border-white/15 text-zinc-100 hover:bg-white/15'
          }`}
        >
          <Coins className="w-3.5 h-3.5 text-red-400 shrink-0" aria-hidden="true" />
          <span>₱{pricePerMedal}</span>
          <SlidersHorizontal className="w-3 h-3 text-zinc-300 shrink-0" aria-hidden="true" />
        </button>

        {showConfigPopover && (
          <div
            role="dialog"
            aria-label="Engraving station configuration"
            className="absolute right-0 top-full mt-2 z-50 w-72 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-primary)] p-4 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                Station Config
              </span>
              <button
                type="button"
                onClick={() => setShowConfigPopover(false)}
                aria-label="Close station config"
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <div>
              <label
                htmlFor="pricing_per_medal_input"
                className="block text-xs font-semibold text-[var(--text-primary)] mb-1.5"
              >
                Setup Pricing (PHP per medal)
              </label>
              <div className="flex items-center gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] px-3 h-10 focus-within:ring-2 focus-within:ring-red-600 dark:focus-within:ring-red-400">
                <span className="text-sm font-mono font-semibold text-red-700 dark:text-red-400">₱</span>
                <input
                  id="pricing_per_medal_input"
                  type="number"
                  min="0"
                  value={pricePerMedal === 0 ? '' : pricePerMedal}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    handlePriceChange(Number.isNaN(val) ? 0 : val);
                  }}
                  placeholder="150"
                  className="w-full bg-transparent text-sm font-mono font-semibold text-[var(--text-primary)] focus:outline-none"
                />
              </div>
              <p className="text-xs text-[var(--text-secondary)] mt-1">
                Used to compute completed and potential earnings in the telemetry strip.
              </p>
            </div>

            {Object.keys(stats.byDistance).length > 0 && (
              <div className="border-t border-[var(--border-subtle)] pt-3 space-y-1.5">
                <span className="block text-xs font-semibold text-[var(--text-secondary)]">
                  Distance Breakdown
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(stats.byDistance).map(([distName, distCount]) => (
                    <span
                      key={distName}
                      className="inline-flex items-center gap-1 rounded-md border border-[var(--border-default)] bg-[var(--surface-inset)] px-2 py-0.5 text-xs font-mono text-[var(--text-primary)]"
                    >
                      <span>{distName}</span>
                      <span className="font-semibold text-red-700 dark:text-red-400">{distCount}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="border-t border-[var(--border-subtle)] pt-3 flex flex-col gap-2">
              <button
                type="button"
                hidden={!can('engraving.export')}
                onClick={() => {
                  setShowConfigPopover(false);
                  setShowLightBurnModal(true);
                }}
                className="w-full min-h-10 px-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] flex items-center justify-between"
              >
                <span className="flex items-center gap-2">
                  <HelpCircle className="w-4 h-4 text-red-700 dark:text-red-400" aria-hidden="true" />
                  LightBurn CSV Guide
                </span>
                <ChevronRight className="w-3.5 h-3.5 text-[var(--text-secondary)]" aria-hidden="true" />
              </button>

              <button
                type="button"
                hidden={!authority}
                onClick={handlePurgeDatabase}
                className="w-full min-h-10 px-3 rounded-lg border border-red-600/30 bg-red-600/10 hover:bg-red-700 hover:text-white text-xs font-semibold text-red-700 dark:text-red-400 flex items-center gap-2 transition-colors"
              >
                <Trash2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Purge Queue Database...</span>
              </button>
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        hidden={!can('engraving.export')}
        onClick={() => setShowLightBurnModal(true)}
        aria-label="Open LightBurn Variable-Text guide"
        title="LightBurn Variable-Text integration guide"
        className="h-9 w-9 rounded-lg border border-white/15 bg-white/10 hover:bg-white/15 text-zinc-200 hover:text-white flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 shrink-0"
      >
        <HelpCircle className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );

  // Action transition helper for active order
  const renderPrimaryStatusButton = (order: EngravingOrder, compact = false) => {
    if (!can('engraving.status')) return null;
    const baseClass = compact
      ? 'h-8 px-2.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1 transition-colors whitespace-nowrap'
      : 'flex-1 min-h-11 px-4 rounded-xl text-xs font-semibold uppercase tracking-wider inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap';

    if (order.status === 'queued') {
      return (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void handleUpdateStatus(order.id, 'inprogress');
          }}
          className={`${baseClass} bg-red-700 hover:bg-red-600 text-white`}
        >
          <Play className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Start Laser</span>
        </button>
      );
    }
    if (order.status === 'inprogress') {
      return (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void handleUpdateStatus(order.id, 'ready');
          }}
          className={`${baseClass} bg-blue-700 hover:bg-blue-600 text-white`}
        >
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Mark Ready</span>
        </button>
      );
    }
    if (order.status === 'ready') {
      return (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void handleUpdateStatus(order.id, 'completed');
          }}
          className={`${baseClass} bg-emerald-700 hover:bg-emerald-600 text-white`}
        >
          <CheckSquare className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Picked Up</span>
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void handleUpdateStatus(order.id, 'queued');
        }}
        className={`${baseClass} border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-[var(--text-primary)]`}
      >
        <RefreshCw className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>Requeue</span>
      </button>
    );
  };

  // Telemetry Strip (6 read-only status & revenue KPIs in 48px horizontal ribbon)
  const telemetryItems: {
    key: 'all' | EngravingStatus;
    label: string;
    value: number;
    accentClass: string;
  }[] = [
    { key: 'all', label: 'Recorded', value: stats.total, accentClass: 'text-[var(--text-primary)]' },
    {
      key: 'queued',
      label: 'Awaiting Cut',
      value: stats.queued,
      accentClass: 'text-yellow-700 dark:text-yellow-400',
    },
    {
      key: 'inprogress',
      label: 'Laser Active',
      value: stats.inprogress,
      accentClass: 'text-red-700 dark:text-red-400',
    },
    {
      key: 'ready',
      label: 'Ready for P/U',
      value: stats.ready,
      accentClass: 'text-blue-700 dark:text-blue-400',
    },
    {
      key: 'completed',
      label: 'Handed Over',
      value: stats.completed,
      accentClass: 'text-emerald-700 dark:text-emerald-400',
    },
  ];

  const distanceEntries = Object.entries(stats.byDistance);

  return (
    <div
      id="operator_flow_main"
      className="w-full flex flex-col lg:flex-1 lg:min-h-0 lg:overflow-hidden"
    >
      {/* Semantic H1 for screen readers without consuming vertical space above the fold */}
      <h1 className="sr-only">Medal Engraving Command Center</h1>

      {/* Portaled Desktop Global Header Controls */}
      {isDesktop && headerCtx?.leftSlotEl && createPortal(headerLeftMarkup, headerCtx.leftSlotEl)}
      {isDesktop && headerCtx?.rightSlotEl && createPortal(headerRightMarkup, headerCtx.rightSlotEl)}

      {/* Mobile / Tablet Responsive Action & Event Bar (< 1024px) */}
      {!isDesktop && (
        <div className="space-y-2 mb-2">
          <div className="glass-panel p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-display font-semibold text-[var(--text-primary)]">
                  Medal Engraving Command
                </h2>
                <p className="text-xs text-[var(--text-secondary)]">
                  {isOnline ? 'Online sync active' : 'Offline sync mode'}
                  {lanConnected ? ' · LAN connected' : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={openQrModal}
                className="min-h-11 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5"
              >
                <QrCode className="w-4 h-4" aria-hidden="true" /> Scan QR
              </button>
            </div>

            <div>
              <label
                htmlFor="mobile_event_select"
                className="block text-xs font-semibold text-[var(--text-secondary)] mb-1"
              >
                Race event
              </label>
              <select
                id="mobile_event_select"
                value={selectedRaceId}
                onChange={(event) => {
                  setSelectedRaceId(event.target.value);
                  setRunnerSearch('');
                }}
                className="w-full min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-3 text-sm font-semibold text-[var(--text-primary)]"
              >
                <option value="">All Events (Global Queue)</option>
                {sortedRaces.map((race) => (
                  <option key={race.id} value={race.id}>
                    {race.name} ({race.date})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                hidden={!can('engraving.export')}
                onClick={handleDownloadCSV}
                className="min-h-11 px-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5"
              >
                <FileDown className="w-3.5 h-3.5" aria-hidden="true" /> Export CSV
              </button>
              <button
                type="button"
                hidden={!can('engraving.export')}
                onClick={openPdfModal}
                className="min-h-11 px-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5"
              >
                <FileText className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" /> PDF
              </button>
              <button
                type="button"
                onClick={toggleBuzzer}
                aria-pressed={soundEnabled}
                className="min-h-11 px-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5"
              >
                {soundEnabled ? <Volume2 className="w-3.5 h-3.5" aria-hidden="true" /> : <VolumeX className="w-3.5 h-3.5" aria-hidden="true" />}
                {soundEnabled ? 'Buzzer On' : 'Buzzer Off'}
              </button>
              <button
                type="button"
                hidden={!can('engraving.backup')}
                onClick={openBackupModal}
                className="min-h-11 px-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5"
              >
                <DownloadCloud className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" /> Offline
              </button>
              <div className="flex items-center gap-1.5 ml-auto">
                <label htmlFor="mobile_price_input" className="text-xs font-semibold text-[var(--text-secondary)]">
                  ₱
                </label>
                <input
                  id="mobile_price_input"
                  type="number"
                  min="0"
                  aria-label="Price per medal in PHP"
                  value={pricePerMedal === 0 ? '' : pricePerMedal}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    handlePriceChange(Number.isNaN(val) ? 0 : val);
                  }}
                  className="w-20 min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-2.5 text-sm font-mono font-semibold text-[var(--text-primary)]"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New Arrival Inline Toast Banner (non-bouncing) */}
      {newOrderAlert && (
        <div
          role="status"
          className="shrink-0 bg-red-700 text-white px-4 py-2 border-b border-red-800 flex items-center justify-between text-xs font-semibold"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Bell className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{newOrderAlert}</span>
          </div>
          <button
            type="button"
            onClick={() => setNewOrderAlert(null)}
            aria-label="Dismiss new order alert"
            className="p-1 rounded hover:bg-black/20"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Compact 48px Telemetry Strip directly beneath Top Header (ISO 11064-5: read-only telemetry) */}
      <section
        id="operator_stats_grid"
        aria-label="Engraving queue telemetry"
        className="shrink-0 border border-[var(--border-default)] lg:border-x-0 lg:border-t-0 rounded-2xl lg:rounded-none bg-[var(--surface-card)] mb-2 lg:mb-0 lg:h-12 px-3 sm:px-4 py-2 lg:py-0 flex flex-wrap lg:flex-nowrap items-center justify-between gap-2 lg:gap-4 lg:overflow-x-auto"
      >
        <div className="flex flex-wrap lg:flex-nowrap items-center gap-1.5 sm:gap-2 min-w-0">
          {telemetryItems.map((item) => {
            const active = masterView === 'queue' && statusFilter === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setMasterView('queue');
                  setStatusFilter(item.key);
                }}
                aria-pressed={active}
                className={`h-8 px-2.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                  active
                    ? 'border-red-600 bg-red-50 dark:bg-red-950/40 text-[var(--text-primary)]'
                    : 'border-transparent hover:border-[var(--border-subtle)] hover:bg-[var(--surface-hover)] text-[var(--text-secondary)]'
                }`}
              >
                <span className="font-normal">{item.label}</span>
                <span className={`font-mono font-semibold tabular-nums ${item.accentClass}`}>
                  <AnimatedMetricValue
                    value={item.value}
                    loading={loading}
                    skeletonWidthClass="w-6"
                    skeletonHeightClass="h-3.5"
                  />
                </span>
              </button>
            );
          })}

          <span className="hidden lg:block h-4 w-px bg-[var(--border-subtle)] mx-1 shrink-0" aria-hidden="true" />

          {/* Read-only Revenue Summary */}
          <div className="h-8 px-2.5 rounded-lg bg-[var(--surface-inset)] border border-[var(--border-subtle)] inline-flex items-center gap-2 text-xs whitespace-nowrap">
            <span className="text-[var(--text-secondary)]">Earned</span>
            <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
              <AnimatedMetricValue
                value={stats.completed * pricePerMedal}
                loading={loading}
                format={(v) => `₱${v.toLocaleString()}`}
                skeletonWidthClass="w-14"
                skeletonHeightClass="h-3.5"
              />
            </span>
            <span className="text-[var(--text-secondary)] hidden sm:inline font-mono">
              / <AnimatedMetricValue
                value={stats.total * pricePerMedal}
                loading={loading}
                format={(v) => `₱${v.toLocaleString()} pot.`}
                skeletonWidthClass="w-16"
                skeletonHeightClass="h-3.5"
              />
            </span>
          </div>
        </div>

        {/* Inline Distance Tallies (desktop xl+) */}
        {distanceEntries.length > 0 && (
          <div
            aria-label="Orders by race distance"
            className="hidden xl:flex items-center gap-1.5 shrink-0 text-xs font-mono text-[var(--text-secondary)]"
          >
            <BarChart2 className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
            {distanceEntries.slice(0, 4).map(([distName, distCount]) => (
              <span
                key={distName}
                className="px-2 py-0.5 rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] text-[var(--text-primary)]"
              >
                {distName} {distCount}
              </span>
            ))}
            {distanceEntries.length > 4 && (
              <button
                type="button"
                onClick={() => setShowConfigPopover(true)}
                className="px-1.5 py-0.5 rounded hover:bg-[var(--surface-hover)] text-xs font-semibold text-red-700 dark:text-red-400"
              >
                +{distanceEntries.length - 4}
              </button>
            )}
          </div>
        )}
      </section>

      {/* Master-Detail Split-Screen Workspace (65% Queue Table Left / 35% Double-Check Detail Dock Right) */}
      <div className="flex-1 min-h-0 flex flex-col lg:grid lg:grid-cols-[minmax(0,65fr)_minmax(0,35fr)] gap-4 lg:gap-0">
        {/* LEFT MASTER PANE (65% Width): Search, Status Filters & Full-Height Scrollable Queue Table */}
        <section
          aria-label="Order queue and event roster"
          className="flex flex-col min-h-0 lg:h-full bg-[var(--surface-page)] rounded-2xl lg:rounded-none border border-[var(--border-default)] lg:border-y-0 lg:border-l-0 lg:border-r overflow-hidden"
        >
          {/* Compact Queue Toolbar */}
          <div className="shrink-0 px-3 sm:px-4 py-2.5 border-b border-[var(--border-default)] bg-[var(--surface-card)] flex flex-col xl:flex-row xl:items-center xl:justify-between gap-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 min-w-0 xl:flex-1">
              {/* View Switcher: Order Queue vs Event Roster */}
              <div
                role="tablist"
                aria-label="Master list view"
                className="inline-flex self-start rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] p-0.5 shrink-0"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={masterView === 'queue'}
                  onClick={() => setMasterView('queue')}
                  className={`min-h-11 sm:min-h-9 lg:h-8 px-3 sm:px-2.5 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
                    masterView === 'queue'
                      ? 'bg-red-700 text-white'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <ListOrdered className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Queue ({orders.length})</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={masterView === 'roster'}
                  onClick={() => setMasterView('roster')}
                  className={`min-h-11 sm:min-h-9 lg:h-8 px-3 sm:px-2.5 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
                    masterView === 'roster'
                      ? 'bg-red-700 text-white'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <Users className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Roster ({selectedRaceId ? eventRunners.length : 0})</span>
                </button>
              </div>

              {/* Search Input */}
              <div className="relative w-full sm:flex-1 sm:min-w-[180px] xl:max-w-sm">
                <Search
                  className="w-3.5 h-3.5 text-[var(--text-secondary)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <label htmlFor="queue_master_search" className="sr-only">
                  {masterView === 'queue' ? 'Search engraving queue' : 'Search event roster'}
                </label>
                <input
                  ref={queueSearchRef}
                  id="queue_master_search"
                  type="text"
                  placeholder={
                    masterView === 'queue'
                      ? 'Search name, bib, or code... (/)'
                      : 'Find runner, bib, or distance...'
                  }
                  value={masterView === 'queue' ? searchTerm : runnerSearch}
                  onChange={(e) =>
                    masterView === 'queue'
                      ? setSearchTerm(e.target.value)
                      : setRunnerSearch(e.target.value)
                  }
                  className="w-full h-11 sm:h-9 rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] pl-8 pr-8 text-xs font-semibold text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-red-600 dark:focus:ring-red-400"
                />
                {(masterView === 'queue' ? searchTerm : runnerSearch) && (
                  <button
                    type="button"
                    onClick={() =>
                      masterView === 'queue' ? setSearchTerm('') : setRunnerSearch('')
                    }
                    aria-label="Clear search"
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>

            {/* Status Filter Pills (Queue Mode) */}
            {masterView === 'queue' && (
              <div className="flex items-center gap-1.5 overflow-x-auto racepulse-horizontal-scroll touch-pan-x max-w-full shrink-0 py-0.5" role="group" aria-label="Filter queue by status">
                {(['all', 'queued', 'inprogress', 'ready', 'completed'] as const).map((filterOpt) => {
                  const active = statusFilter === filterOpt;
                  const count =
                    filterOpt === 'all'
                      ? stats.total
                      : filterOpt === 'queued'
                        ? stats.queued
                        : filterOpt === 'inprogress'
                          ? stats.inprogress
                          : filterOpt === 'ready'
                            ? stats.ready
                            : stats.completed;
                  const label =
                    filterOpt === 'all' ? 'All' : STATUS_META[filterOpt].shortLabel;

                  return (
                    <button
                      key={filterOpt}
                      type="button"
                      onClick={() => setStatusFilter(filterOpt)}
                      aria-pressed={active}
                      className={`min-h-11 sm:min-h-9 lg:h-8 px-3 sm:px-2.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                        active
                          ? 'bg-red-700 border-red-700 text-white'
                          : 'bg-[var(--surface-inset)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
                      }`}
                    >
                      <span>{label}</span>
                      <span
                        className={`font-mono text-[11px] ${
                          active ? 'text-white/90' : 'text-[var(--text-primary)]'
                        }`}
                      >
                        <AnimatedMetricValue
                          value={count}
                          loading={loading}
                          skeletonWidthClass="w-5"
                          skeletonHeightClass="h-3"
                        />
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Scrollable Queue or Roster Content */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {masterView === 'roster' ? (
              !selectedRaceId ? (
                <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                  <Flag className="w-8 h-8 text-red-700 dark:text-red-400 mb-2" aria-hidden="true" />
                  <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                    No race event selected
                  </h2>
                  <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-sm">
                    Select a race event in the top header bar to inspect its registered runner roster.
                  </p>
                </div>
              ) : eventRunnersLoading ? (
                <div role="status" aria-label="Loading event roster" className="p-4 space-y-2.5">
                  {[0, 1, 2, 3].map((idx) => (
                    <div key={idx} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-2.5">
                      <ValueSkeleton widthClass="w-40" heightClass="h-4" />
                      <ValueSkeleton widthClass="w-16" heightClass="h-4" />
                    </div>
                  ))}
                </div>
              ) : eventRunnersError ? (
                <div role="alert" className="flex flex-col items-center justify-center py-16 px-4 text-center">
                  <AlertTriangle className="w-8 h-8 text-red-700 dark:text-red-400 mb-2" aria-hidden="true" />
                  <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                    Roster unavailable
                  </h2>
                  <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-sm">{eventRunnersError}</p>
                </div>
              ) : filteredEventRunners.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                  <Users className="w-8 h-8 text-[var(--text-secondary)] mb-2" aria-hidden="true" />
                  <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                    {eventRunners.length ? 'No matching runners' : 'No registered runners yet'}
                  </h2>
                  <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-sm">
                    {eventRunners.length
                      ? `No runners in ${selectedRace?.name || 'this event'} match "${runnerSearch}".`
                      : 'Runners registered for this race will appear here automatically.'}
                  </p>
                  {runnerSearch && (
                    <button
                      type="button"
                      onClick={() => setRunnerSearch('')}
                      className="mt-3 h-9 px-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
                    >
                      Clear search
                    </button>
                  )}
                </div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 z-10 bg-[var(--surface-inset)] border-b border-[var(--border-default)] text-xs font-semibold text-[var(--text-secondary)]">
                    <tr>
                      <th className="py-2.5 px-4">Bib #</th>
                      <th className="py-2.5 px-4">Runner Name</th>
                      <th className="py-2.5 px-4">Distance</th>
                      <th className="py-2.5 px-4">Category</th>
                      <th className="py-2.5 px-4 text-right">Copy</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)] text-sm">
                    {filteredEventRunners.map((runner) => {
                      const isCopied = copiedStates[`runner_${runner.uid}`];
                      return (
                        <tr key={runner.uid} className="hover:bg-[var(--surface-hover)]/60">
                          <td className="py-2.5 px-4 font-mono font-semibold text-red-700 dark:text-red-400 whitespace-nowrap">
                            #{runner.bibNumber}
                          </td>
                          <td className="py-2.5 px-4 font-semibold text-[var(--text-primary)]">
                            {runner.fullName || 'Free runner slot'}
                          </td>
                          <td className="py-2.5 px-4 text-xs font-semibold text-[var(--text-secondary)] whitespace-nowrap">
                            {runner.distance}
                          </td>
                          <td className="py-2.5 px-4 text-xs text-[var(--text-secondary)] uppercase">
                            {runner.entryCategory || 'solo'}
                          </td>
                          <td className="py-2.5 px-4 text-right">
                            <button
                              type="button"
                              onClick={() =>
                                handleCopyText(
                                  `runner_${runner.uid}`,
                                  `${runner.fullName}\t${runner.bibNumber}\t${runner.distance}`,
                                )
                              }
                              aria-label={`Copy ${runner.fullName} details`}
                              className="h-8 px-2.5 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-1"
                            >
                              {isCopied ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                                  <span>Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                                  <span>Copy</span>
                                </>
                              )}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )
            ) : loading ? (
              <div role="status" className="flex flex-col items-center justify-center py-20 gap-2 text-xs font-semibold text-[var(--text-secondary)]">
                <RefreshCw className="w-6 h-6 text-red-700 dark:text-red-400 animate-spin" aria-hidden="true" />
                <span>Loading live engraving queue...</span>
              </div>
            ) : ordersError && filteredOrders.length === 0 ? (
              <div role="alert" className="flex flex-col items-center justify-center py-16 px-4 text-center">
                <AlertTriangle className="w-8 h-8 text-red-700 dark:text-red-400 mb-2" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                  Queue connection interrupted
                </h2>
                <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-sm">{ordersError}</p>
                <button
                  type="button"
                  onClick={openQrModal}
                  className="mt-3 h-9 px-3 rounded-lg bg-red-700 text-white text-xs font-semibold"
                >
                  Scan offline QR ticket
                </button>
              </div>
            ) : filteredOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                <ListOrdered className="w-8 h-8 text-[var(--text-secondary)] mb-2" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                  {orders.length === 0 ? 'Engraving queue is empty' : 'No matching orders'}
                </h2>
                <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-sm">
                  {orders.length === 0
                    ? 'Scan a runner QR ticket using Scan QR (Q) or wait for incoming booth submissions.'
                    : 'No orders match the current search term or status filter.'}
                </p>
                {(searchTerm || statusFilter !== 'all') && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchTerm('');
                      setStatusFilter('all');
                    }}
                    className="mt-3 h-9 px-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
                  >
                    Reset filters
                  </button>
                )}
              </div>
            ) : !isDesktop ? (
              /* Mobile / Tablet Compact Card List (< 1024px) */
              <div id="orders_cards_list" className="p-3 space-y-3">
                {filteredOrders.map((order) => {
                  const meta = STATUS_META[order.status];
                  const isSelected = foundDoubleCheckOrder?.id === order.id;
                  const isTsvCopied = copiedStates[`${order.id}_tsv_all`];

                  return (
                    <div
                      key={order.id}
                      onClick={() => setDoubleCheckCode(order.id)}
                      className={`rounded-2xl border border-[var(--border-default)] border-l-4 ${meta.rowAccent} bg-[var(--surface-card)] p-4 space-y-3 transition-colors ${
                        isSelected ? 'ring-2 ring-red-600' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDoubleCheckCode(order.id);
                          }}
                          className="font-mono text-sm font-semibold px-2.5 py-1 rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] text-red-700 dark:text-red-400"
                        >
                          {order.id}
                        </button>
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-semibold ${meta.badgeClass}`}
                        >
                          <StatusIcon status={order.status} />
                          <span>{meta.label}</span>
                        </span>
                      </div>

                      <div>
                        <p className="text-base font-display font-semibold text-[var(--text-primary)]">
                          {order.runnerName}
                        </p>
                        <p className="text-xs text-[var(--text-secondary)] mt-0.5 font-mono">
                          Bib #{order.bibNumber} · {order.distance} · {formatRaceTime(order.finishingTime)}
                        </p>
                        {order.customInscription && (
                          <p className="text-xs text-[var(--text-secondary)] mt-1 italic">
                            "{order.customInscription}"
                          </p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[var(--border-subtle)]">
                        {renderPrimaryStatusButton(order)}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopyTSVRow(order);
                          }}
                          className="min-h-11 px-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-1"
                        >
                          {isTsvCopied ? <Check className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>{isTsvCopied ? 'Copied' : 'TSV'}</span>
                        </button>
                        {authority && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteOrder(order.id, order.runnerName);
                            }}
                            aria-label={`Delete order ${order.id}`}
                            className="min-h-11 px-3 rounded-xl border border-[var(--border-default)] text-red-700 dark:text-red-400"
                          >
                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Desktop Full-Height Scrollable Data Table with Sticky Column Headers */
              <table id="orders_cards_list" className="w-full text-left border-collapse">
                <thead className="sticky top-0 z-10 bg-[var(--surface-inset)] border-b border-[var(--border-default)] text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  <tr>
                    <th className="py-2.5 pl-4 pr-2 w-24">Code</th>
                    <th className="py-2.5 px-3">Runner &amp; Inscription</th>
                    <th className="py-2.5 px-3 w-36">Bib / Dist</th>
                    <th className="py-2.5 px-3 w-40">Finish Time</th>
                    <th className="py-2.5 px-3 w-32">Status</th>
                    <th className="py-2.5 pl-3 pr-4 text-right w-56">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)] text-sm">
                  {filteredOrders.map((order) => {
                    const meta = STATUS_META[order.status];
                    const isSelected = foundDoubleCheckOrder?.id === order.id;
                    const isTsvCopied = copiedStates[`${order.id}_tsv_all`];
                    const isTimeCopied = copiedStates[`${order.id}_time`];

                    return (
                      <tr
                        key={order.id}
                        onClick={() => setDoubleCheckCode(order.id)}
                        className={`cursor-pointer border-l-4 transition-colors ${
                          isSelected
                            ? 'border-l-red-600 bg-red-500/[0.08]'
                            : `${meta.rowAccent} hover:bg-[var(--surface-hover)]/65 ${
                                order.status === 'completed' ? 'opacity-75 hover:opacity-100' : ''
                              }`
                        }`}
                      >
                        <td className="py-2.5 pl-3 pr-2 align-middle">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDoubleCheckCode(order.id);
                            }}
                            aria-label={`Inspect order ${order.id} for ${order.runnerName}`}
                            className={`px-2 py-1 rounded-md font-mono text-xs font-semibold border transition-colors ${
                              isSelected
                                ? 'bg-red-700 text-white border-red-700'
                                : 'bg-[var(--surface-card)] text-red-700 dark:text-red-400 border-[var(--border-default)] hover:border-red-600'
                            }`}
                          >
                            {order.id}
                          </button>
                        </td>

                        <td className="py-2.5 px-3 align-middle max-w-[260px]">
                          <div className="font-display font-semibold text-[var(--text-primary)] truncate">
                            {order.runnerName}
                          </div>
                          {(order.customInscription || order.rank) && (
                            <div className="text-xs text-[var(--text-secondary)] truncate mt-0.5">
                              {order.rank ? `${order.rank}` : ''}
                              {order.rank && order.customInscription ? ' · ' : ''}
                              {order.customInscription ? `"${order.customInscription}"` : ''}
                            </div>
                          )}
                        </td>

                        <td className="py-2.5 px-3 align-middle whitespace-nowrap">
                          <span className="font-mono font-semibold text-[var(--text-primary)]">
                            #{order.bibNumber}
                          </span>
                          <span className="text-xs text-[var(--text-secondary)] ml-1.5">
                            {order.distance}
                          </span>
                        </td>

                        <td className="py-2.5 px-3 align-middle whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <span className="font-mono text-xs font-semibold text-[var(--text-primary)]">
                              {formatRaceTime(order.finishingTime)}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCopyText(`${order.id}_time`, formatRaceTime(order.finishingTime));
                              }}
                              aria-label={`Copy finish time for ${order.runnerName}`}
                              title="Copy finish time"
                              className="p-1 rounded border border-transparent hover:border-[var(--border-default)] hover:bg-[var(--surface-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                            >
                              {isTimeCopied ? (
                                <Check className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                              )}
                            </button>
                          </div>
                        </td>

                        <td className="py-2.5 px-3 align-middle whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold ${meta.badgeClass}`}
                          >
                            <StatusIcon status={order.status} />
                            <span>{meta.label}</span>
                          </span>
                        </td>

                        <td className="py-2.5 pl-3 pr-4 align-middle text-right whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            {renderPrimaryStatusButton(order, true)}

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCopyTSVRow(order);
                              }}
                              title="Copy complete TSV row for LightBurn / Excel"
                              aria-label={`Copy TSV row for ${order.runnerName}`}
                              className={`h-8 px-2 rounded-lg border text-xs font-semibold inline-flex items-center gap-1 transition-colors ${
                                isTsvCopied
                                  ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400'
                                  : 'border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-[var(--text-primary)]'
                              }`}
                            >
                              {isTsvCopied ? (
                                <Check className="w-3.5 h-3.5" aria-hidden="true" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                              )}
                              <span>TSV</span>
                            </button>

                            <button
                              type="button"
                              hidden={!authority}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteOrder(order.id, order.runnerName);
                              }}
                              title="Delete order"
                              aria-label={`Delete order ${order.id}`}
                              className="h-8 w-8 rounded-lg border border-transparent hover:border-red-600/40 hover:bg-red-600/10 text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-400 inline-flex items-center justify-center transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* RIGHT DETAIL DOCK (35% Width): Persistent Double-Check Verification & Laser Control Panel */}
        <aside
          id="double_check_terminal"
          aria-label="Double-Check verification and laser controls"
          className="flex flex-col min-h-0 lg:h-full bg-[var(--surface-card)] rounded-2xl lg:rounded-none border lg:border-0 border-[var(--border-default)] overflow-hidden"
        >
          {/* Dock Header + Ref Code Lookup */}
          <div className="shrink-0 px-4 py-3 border-b border-[var(--border-default)] bg-[var(--surface-inset)]/60 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-display font-semibold uppercase tracking-wide text-[var(--text-primary)]">
                  Double-Check Terminal
                </h2>
                <p className="text-xs text-[var(--text-secondary)]">
                  Click any queue row or enter ref code (D)
                </p>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => stepActiveOrder(-1)}
                  disabled={filteredOrders.length === 0}
                  aria-label="Previous queue order"
                  title="Previous order in queue"
                  className="w-8 h-8 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-[var(--text-primary)] flex items-center justify-center disabled:opacity-40"
                >
                  <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => stepActiveOrder(1)}
                  disabled={filteredOrders.length === 0}
                  aria-label="Next queue order"
                  title="Next order in queue"
                  className="w-8 h-8 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-[var(--text-primary)] flex items-center justify-center disabled:opacity-40"
                >
                  <ChevronRight className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="relative">
              <label htmlFor="double_check_code_input" className="sr-only">
                Ref code verification input
              </label>
              <input
                ref={doubleCheckInputRef}
                id="double_check_code_input"
                type="text"
                placeholder="ENTER REF CODE (E.G. A29B)"
                maxLength={16}
                value={doubleCheckCode}
                onChange={(e) => setDoubleCheckCode(e.target.value.toUpperCase())}
                className="w-full h-10 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3.5 pr-9 text-sm font-mono font-semibold tracking-widest text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-red-600 dark:focus:ring-red-400"
              />
              {doubleCheckCode && (
                <button
                  type="button"
                  onClick={() => setDoubleCheckCode('')}
                  aria-label="Clear verification code"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>

          {/* Dock Body */}
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
            {foundDoubleCheckOrder ? (
              <>
                {/* Matched Code + Status Banner */}
                <div className="rounded-xl border border-red-600/30 bg-red-500/[0.06] px-4 py-3 flex items-center justify-between gap-3">
                  <div>
                    <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                      Matched Ref Code
                    </span>
                    <span className="text-3xl font-mono font-semibold text-red-700 dark:text-red-400 leading-tight">
                      {foundDoubleCheckOrder.id}
                    </span>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-semibold ${
                      STATUS_META[foundDoubleCheckOrder.status].badgeClass
                    }`}
                  >
                    <StatusIcon status={foundDoubleCheckOrder.status} />
                    <span>{STATUS_META[foundDoubleCheckOrder.status].label}</span>
                  </span>
                </div>

                {/* Grand-Font Verification Fields */}
                <div className="space-y-2.5">
                  {/* 1. Runner Full Name (untruncated for spelling verification) */}
                  <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                        1. Runner Full Name
                      </span>
                      <p className="text-xl xl:text-2xl font-display font-semibold text-[var(--text-primary)] break-words leading-snug mt-1">
                        {foundDoubleCheckOrder.runnerName}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopyText('lookup_name', foundDoubleCheckOrder.runnerName)}
                      aria-label="Copy runner full name"
                      title="Copy Name"
                      className="shrink-0 w-10 h-10 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-[var(--text-primary)] flex items-center justify-center"
                    >
                      {copiedStates['lookup_name'] ? (
                        <Check className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                      ) : (
                        <Copy className="w-4 h-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>

                  {/* 2. Finishing Time */}
                  <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                        2. Finishing Time
                      </span>
                      <p className="text-xl xl:text-2xl font-mono font-semibold text-red-700 dark:text-red-400 mt-0.5 tabular-nums">
                        {formatRaceTime(foundDoubleCheckOrder.finishingTime)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        handleCopyText(
                          'lookup_time',
                          formatRaceTime(foundDoubleCheckOrder.finishingTime),
                        )
                      }
                      aria-label="Copy finishing time"
                      title="Copy Time"
                      className="shrink-0 w-10 h-10 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-[var(--text-primary)] flex items-center justify-center"
                    >
                      {copiedStates['lookup_time'] ? (
                        <Check className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                      ) : (
                        <Copy className="w-4 h-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>

                  {/* 3. Bib Number & Distance */}
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                          3. Bib
                        </span>
                        <p className="text-lg font-mono font-semibold text-[var(--text-primary)] truncate mt-0.5">
                          #{foundDoubleCheckOrder.bibNumber}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopyText('lookup_bib', foundDoubleCheckOrder.bibNumber)}
                        aria-label="Copy bib number"
                        title="Copy Bib"
                        className="shrink-0 w-9 h-9 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-[var(--text-primary)] flex items-center justify-center"
                      >
                        {copiedStates['lookup_bib'] ? (
                          <Check className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                        )}
                      </button>
                    </div>

                    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                          Distance
                        </span>
                        <p className="text-lg font-display font-semibold text-[var(--text-primary)] truncate mt-0.5">
                          {foundDoubleCheckOrder.distance}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopyText('lookup_dist', foundDoubleCheckOrder.distance)}
                        aria-label="Copy distance"
                        title="Copy Distance"
                        className="shrink-0 w-9 h-9 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-[var(--text-primary)] flex items-center justify-center"
                      >
                        {copiedStates['lookup_dist'] ? (
                          <Check className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* 4. Official Rank */}
                  <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                        4. Official Rank
                      </span>
                      <p className="text-base font-semibold text-[var(--text-primary)] mt-0.5">
                        {foundDoubleCheckOrder.rank || 'Not ranked'}
                      </p>
                    </div>
                    {foundDoubleCheckOrder.rank && (
                      <button
                        type="button"
                        onClick={() => handleCopyText('lookup_rank', foundDoubleCheckOrder.rank!)}
                        aria-label="Copy official rank"
                        title="Copy Rank"
                        className="shrink-0 w-10 h-10 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-[var(--text-primary)] flex items-center justify-center"
                      >
                        {copiedStates['lookup_rank'] ? (
                          <Check className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                        ) : (
                          <Copy className="w-4 h-4" aria-hidden="true" />
                        )}
                      </button>
                    )}
                  </div>

                  {/* 5. Custom Inscription */}
                  <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                        5. Custom Inscription
                      </span>
                      <p className="text-base font-semibold text-[var(--text-primary)] break-words mt-0.5">
                        {foundDoubleCheckOrder.customInscription
                          ? `"${foundDoubleCheckOrder.customInscription}"`
                          : 'No custom inscription'}
                      </p>
                    </div>
                    {foundDoubleCheckOrder.customInscription && (
                      <button
                        type="button"
                        onClick={() =>
                          handleCopyText(
                            'lookup_inscription',
                            foundDoubleCheckOrder.customInscription!,
                          )
                        }
                        aria-label="Copy custom inscription"
                        title="Copy Inscription"
                        className="shrink-0 w-10 h-10 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-[var(--text-primary)] flex items-center justify-center"
                      >
                        {copiedStates['lookup_inscription'] ? (
                          <Check className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                        ) : (
                          <Copy className="w-4 h-4" aria-hidden="true" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </>
            ) : doubleCheckCode.trim() ? (
              <div className="rounded-xl border border-red-600/30 bg-red-500/[0.06] p-5 text-center space-y-3">
                <AlertTriangle className="w-7 h-7 text-red-700 dark:text-red-400 mx-auto" aria-hidden="true" />
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                    No active order matches "{doubleCheckCode.toUpperCase()}"
                  </h3>
                  <p className="text-xs text-[var(--text-secondary)] mt-1">
                    Check the 4-character ticket code or click a runner row in the queue.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setDoubleCheckCode('')}
                  className="h-9 px-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
                >
                  Clear lookup
                </button>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-[var(--border-default)] bg-[var(--surface-inset)] p-5 text-center space-y-3">
                <Printer className="w-7 h-7 text-red-700 dark:text-red-400 mx-auto" aria-hidden="true" />
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                    Ready for Laser Verification
                  </h3>
                  <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
                    Select any runner from the queue on the left or enter their passcode above to
                    inspect spelling and copy fields into LightBurn.
                  </p>
                </div>
                {filteredOrders.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setDoubleCheckCode(filteredOrders[0].id)}
                    className="min-h-10 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold uppercase tracking-wider transition-colors"
                  >
                    Load Next Order ({filteredOrders[0].id})
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Dock Pinned Laser Action Footer (when an order is loaded) */}
          {foundDoubleCheckOrder && (
            <div className="shrink-0 p-4 border-t border-[var(--border-default)] bg-[var(--surface-inset)]/70 space-y-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleCopyTSVRow(foundDoubleCheckOrder)}
                  className="flex-1 min-h-11 px-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)] inline-flex items-center justify-center gap-1.5 transition-colors"
                >
                  {copiedStates[`${foundDoubleCheckOrder.id}_tsv_all`] ? (
                    <>
                      <Check className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                      <span>Copied Row (TSV)</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" aria-hidden="true" />
                      <span>Copy Row (TSV)</span>
                    </>
                  )}
                </button>

                {renderPrimaryStatusButton(foundDoubleCheckOrder)}
              </div>

              {authority && (
                <button
                  type="button"
                  onClick={() =>
                    handleDeleteOrder(foundDoubleCheckOrder.id, foundDoubleCheckOrder.runnerName)
                  }
                  className="w-full h-9 rounded-lg border border-red-600/25 hover:bg-red-600/10 text-xs font-semibold text-red-700 dark:text-red-400 inline-flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Delete Order</span>
                </button>
              )}
            </div>
          )}
        </aside>
      </div>

      {/* LightBurn Integration Guide Modal */}
      {showLightBurnModal && (
        <DialogSurface
          titleId="lightburn_guide_title"
          onRequestClose={() => setShowLightBurnModal(false)}
          className="fixed inset-0 m-auto h-fit rounded-2xl w-[calc(100%-2rem)] max-w-2xl max-h-[90dvh] flex flex-col overflow-hidden shadow-2xl"
        >
          <div className="p-5 border-b border-[var(--border-default)] flex items-center justify-between bg-[var(--surface-inset)]">
            <div className="flex items-center gap-2.5">
              <Cpu className="w-5 h-5 text-red-700 dark:text-red-400" aria-hidden="true" />
              <div>
                <h2
                  id="lightburn_guide_title"
                  className="text-base font-display font-semibold uppercase tracking-tight text-[var(--text-primary)]"
                >
                  LightBurn Variable-Text Integration
                </h2>
                <p className="text-xs text-[var(--text-secondary)] font-mono">
                  Automated medal engraving pipeline
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowLightBurnModal(false)}
              className="min-h-10 px-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" /> Close
            </button>
          </div>

          <div className="p-6 overflow-y-auto space-y-5 text-sm leading-relaxed">
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-red-700 dark:text-red-400 mb-1">
                Variable Text CSV Sync
              </h3>
              <p className="text-xs text-[var(--text-secondary)]">
                Link LightBurn Variable Text directly to the exported CSV spreadsheet so runner names
                and times load without manual retyping.
              </p>
            </div>

            <div className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)] border-b border-[var(--border-subtle)] pb-2">
                Connection Steps
              </h3>

              <div className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-[var(--surface-inset)] border border-[var(--border-default)] text-xs font-mono font-semibold text-red-700 dark:text-red-400 flex items-center justify-center shrink-0">
                  1
                </span>
                <div>
                  <h4 className="text-xs font-semibold uppercase text-[var(--text-primary)]">
                    Export the Data Feed
                  </h4>
                  <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                    Click <strong className="text-[var(--text-primary)]">CSV (E)</strong> in the top
                    header and save <code className="font-mono">racepulse_lightburn_sync.csv</code> on
                    your laser workstation.
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-[var(--surface-inset)] border border-[var(--border-default)] text-xs font-mono font-semibold text-red-700 dark:text-red-400 flex items-center justify-center shrink-0">
                  2
                </span>
                <div>
                  <h4 className="text-xs font-semibold uppercase text-[var(--text-primary)]">
                    Bind %-Index Fields in LightBurn
                  </h4>
                  <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                    Set text objects on your medal template to Merge/CSV Variable Text using these
                    column offsets:
                  </p>
                  <div className="grid grid-cols-2 gap-2 mt-2 font-mono text-xs">
                    <div className="bg-[var(--surface-inset)] p-2 rounded border border-[var(--border-subtle)]">
                      <span className="text-red-700 dark:text-red-400 font-semibold">%2</span> Runner Name
                    </div>
                    <div className="bg-[var(--surface-inset)] p-2 rounded border border-[var(--border-subtle)]">
                      <span className="text-red-700 dark:text-red-400 font-semibold">%3</span> Bib Number
                    </div>
                    <div className="bg-[var(--surface-inset)] p-2 rounded border border-[var(--border-subtle)]">
                      <span className="text-red-700 dark:text-red-400 font-semibold">%4</span> Finishing Time
                    </div>
                    <div className="bg-[var(--surface-inset)] p-2 rounded border border-[var(--border-subtle)]">
                      <span className="text-red-700 dark:text-red-400 font-semibold">%5</span> Race Distance
                    </div>
                    <div className="bg-[var(--surface-inset)] p-2 rounded border border-[var(--border-subtle)]">
                      <span className="text-red-700 dark:text-red-400 font-semibold">%6</span> Official Rank
                    </div>
                    <div className="bg-[var(--surface-inset)] p-2 rounded border border-[var(--border-subtle)]">
                      <span className="text-red-700 dark:text-red-400 font-semibold">%7</span> Custom Inscription
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-[var(--surface-inset)] border border-[var(--border-default)] text-xs font-mono font-semibold text-red-700 dark:text-red-400 flex items-center justify-center shrink-0">
                  3
                </span>
                <div>
                  <h4 className="text-xs font-semibold uppercase text-[var(--text-primary)]">
                    Open Variable Text &amp; Link CSV
                  </h4>
                  <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                    Open <code className="font-mono">Window &rarr; Variable Text</code> in LightBurn,
                    browse to the exported CSV, and step rows with Previous/Next or reload after new
                    queue submissions.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="p-4 border-t border-[var(--border-default)] bg-[var(--surface-inset)] flex justify-end gap-2">
            <button
              type="button"
              hidden={!can('engraving.export')}
              onClick={handleDownloadCSV}
              className="min-h-10 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold uppercase tracking-wider inline-flex items-center gap-1.5"
            >
              <FileDown className="w-4 h-4" aria-hidden="true" /> Download Active CSV
            </button>
          </div>
        </DialogSurface>
      )}

      {/* QR SCANNER MODAL */}
      {showQrScanModal && (
        <QrScannerModal
          onClose={() => setShowQrScanModal(false)}
          onScanSuccess={handleRegisterScannedOrder}
          successMessage={qrScanSuccessMessage}
          errorMessage={qrScanError}
        />
      )}

      {/* PDF REPORT GENERATOR MODAL */}
      {showPdfModal && (
        <DialogSurface
          titleId="pdf_modal_title"
          onRequestClose={() => setShowPdfModal(false)}
          className="fixed inset-0 m-auto h-fit rounded-2xl w-[calc(100%-2rem)] max-w-md max-h-[90dvh] overflow-hidden shadow-2xl flex flex-col"
        >
          <div className="p-5 border-b border-[var(--border-default)] flex items-center justify-between bg-[var(--surface-inset)]">
            <div className="flex items-center gap-2.5">
              <FileText className="w-5 h-5 text-red-700 dark:text-red-400" aria-hidden="true" />
              <div>
                <h2
                  id="pdf_modal_title"
                  className="text-base font-display font-semibold uppercase tracking-tight text-[var(--text-primary)]"
                >
                  Generate PDF Report
                </h2>
                <p className="text-xs text-[var(--text-secondary)]">
                  Export race finisher records and laser status
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowPdfModal(false)}
              aria-label="Close PDF dialog"
              className="w-9 h-9 rounded-lg hover:bg-[var(--surface-hover)] text-[var(--text-secondary)] flex items-center justify-center"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          <div className="p-5 space-y-4">
            <div>
              <label
                htmlFor="pdf_race_name_input"
                className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)] mb-1.5"
              >
                Race / Event Name
              </label>
              <input
                id="pdf_race_name_input"
                type="text"
                value={pdfRaceName}
                onChange={(e) => setPdfRaceName(e.target.value)}
                placeholder="e.g. Bukidnon 42K Ultra Run"
                className="w-full min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-3.5 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-600 dark:focus:ring-red-400"
              />
            </div>

            <div>
              <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)] mb-1.5">
                Filter Records to Include
              </span>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'all', label: 'All Orders', count: orders.length },
                  {
                    id: 'completed',
                    label: 'Completed Only',
                    count: orders.filter((o) => o.status === 'completed').length,
                  },
                  {
                    id: 'queued',
                    label: 'Queued',
                    count: orders.filter((o) => o.status === 'queued').length,
                  },
                  {
                    id: 'inprogress',
                    label: 'Engraving',
                    count: orders.filter((o) => o.status === 'inprogress').length,
                  },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() =>
                      setPdfReportFilter(item.id as 'all' | 'completed' | 'queued' | 'inprogress')
                    }
                    className={`min-h-11 px-3 rounded-xl border text-left flex items-center justify-between text-xs font-semibold transition-colors ${
                      pdfReportFilter === item.id
                        ? 'bg-red-50 dark:bg-red-950/40 border-red-600 text-[var(--text-primary)]'
                        : 'bg-[var(--surface-inset)] border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]'
                    }`}
                  >
                    <span>{item.label}</span>
                    <span className="font-mono text-xs">{item.count}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="p-4 border-t border-[var(--border-default)] bg-[var(--surface-inset)] flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowPdfModal(false)}
              className="min-h-10 px-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] text-xs font-semibold text-[var(--text-primary)]"
            >
              Cancel
            </button>
            <button
              type="button"
              hidden={!can('engraving.export')}
              onClick={handleGeneratePdfReport}
              className="min-h-10 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold uppercase tracking-wider inline-flex items-center gap-1.5"
            >
              <FileDown className="w-4 h-4" aria-hidden="true" /> Download PDF
            </button>
          </div>
        </DialogSurface>
      )}

      {/* OFFLINE BACKUP & SYNC MODAL */}
      {showBackupModal && (
        <DialogSurface
          titleId="backup_modal_title"
          onRequestClose={() => setShowBackupModal(false)}
          className="fixed inset-0 m-auto h-fit rounded-2xl w-[calc(100%-2rem)] max-w-md max-h-[90dvh] overflow-hidden shadow-2xl flex flex-col"
        >
          <div className="p-5 border-b border-[var(--border-default)] flex items-center justify-between bg-[var(--surface-inset)]">
            <div className="flex items-center gap-2.5">
              <DownloadCloud className="w-5 h-5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
              <div>
                <h2
                  id="backup_modal_title"
                  className="text-base font-display font-semibold uppercase tracking-tight text-[var(--text-primary)]"
                >
                  Offline DB Sync
                </h2>
                <p className="text-xs text-[var(--text-secondary)] font-mono">
                  Dual-laptop JSON transfer
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowBackupModal(false)}
              className="min-h-10 px-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" /> Close
            </button>
          </div>

          <div className="p-5 space-y-4">
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-3.5 text-xs text-[var(--text-secondary)] space-y-1.5">
              <span className="font-semibold uppercase text-emerald-700 dark:text-emerald-400 block">
                Dual-Laptop Integration
              </span>
              <ol className="list-decimal pl-4 space-y-1">
                <li>Export the active queue JSON from the registration station.</li>
                <li>Transfer the `.json` file via USB flash drive to this engraving station.</li>
                <li>Import the file below to merge entries into the local queue.</li>
              </ol>
            </div>

            <div className="p-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)]">
                1. Export Active Queue
              </h3>
              <button
                type="button"
                hidden={!can('engraving.backup')}
                onClick={handleExportOfflineBackup}
                className="w-full min-h-11 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold uppercase tracking-wider flex items-center justify-center gap-1.5"
              >
                <DownloadCloud className="w-4 h-4" aria-hidden="true" /> Export Queue Backup
              </button>
            </div>

            <div className="p-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] space-y-2">
              <label
                htmlFor="offline_json_import"
                className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)]"
              >
                2. Import / Restore Queue (.json)
              </label>
              <input
                id="offline_json_import"
                type="file"
                accept=".json"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleImportOfflineBackup(file);
                }}
                className="w-full text-xs text-[var(--text-secondary)] font-mono file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-[var(--border-default)] file:text-xs file:font-semibold file:bg-[var(--surface-card)] file:text-[var(--text-primary)]"
              />
            </div>

            {backupErrorMessage && (
              <div
                role="alert"
                className="text-xs text-red-700 dark:text-red-400 font-semibold p-3 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center gap-2"
              >
                <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{backupErrorMessage}</span>
              </div>
            )}

            {backupSuccessMessage && (
              <div
                role="status"
                className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{backupSuccessMessage}</span>
              </div>
            )}
          </div>
        </DialogSurface>
      )}

      {/* DELETE SINGLE ORDER CONFIRMATION DIALOG */}
      {deleteConfirmOrder && (
        <DialogSurface
          titleId="delete_order_title"
          descriptionId="delete_order_desc"
          onRequestClose={() => setDeleteConfirmOrder(null)}
          alert
          className="rp-confirm"
        >
          <div className="rp-confirm-symbol is-destructive">
            <Trash2 size={24} aria-hidden="true" />
          </div>
          <h2 id="delete_order_title">Delete engraving order?</h2>
          <p id="delete_order_desc">
            Removing order <strong>{deleteConfirmOrder.id}</strong> for{' '}
            <strong>{deleteConfirmOrder.runnerName}</strong> (Bib #{deleteConfirmOrder.bibNumber},{' '}
            {deleteConfirmOrder.distance}, {formatRaceTime(deleteConfirmOrder.finishingTime)})
            cannot be undone.
          </p>
          <div className="rp-confirm-actions">
            <button
              type="button"
              className="rp-button rp-button-secondary"
              onClick={() => setDeleteConfirmOrder(null)}
            >
              Keep order
            </button>
            <button
              type="button"
              hidden={!authority}
              className="rp-button rp-button-danger"
              onClick={handleExecuteDeleteOrder}
            >
              Confirm delete
            </button>
          </div>
        </DialogSurface>
      )}

      {/* PURGE QUEUE DATABASE CONFIRMATION DIALOG */}
      {showPurgeConfirm && (
        <DialogSurface
          titleId="purge_db_title"
          descriptionId="purge_db_desc"
          onRequestClose={() => setShowPurgeConfirm(false)}
          alert
          className="rp-confirm"
        >
          <div className="rp-confirm-symbol is-destructive">
            <AlertTriangle size={24} aria-hidden="true" />
          </div>
          <h2 id="purge_db_title">Purge all {stats.total} engraving orders?</h2>
          <p id="purge_db_desc">
            This clears all active, queued ({stats.queued + stats.inprogress + stats.ready}), and
            completed ({stats.completed}) orders from both Firestore and the local LAN server.
            Export an offline backup first if you need a record.
          </p>
          <div className="rp-confirm-actions">
            <button
              type="button"
              className="rp-button rp-button-secondary"
              onClick={() => setShowPurgeConfirm(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              hidden={!authority}
              className="rp-button rp-button-danger"
              onClick={handleExecutePurgeDatabase}
            >
              Purge all orders
            </button>
          </div>
        </DialogSurface>
      )}
    </div>
  );
}

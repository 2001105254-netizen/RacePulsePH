import { formatRaceTime } from '../lib/preciseTime';
import { useAccess, authenticatedFetch } from '../lib/access';
import { startLanJsonPoller } from '../lib/lanBridge';
import React, { useState, useEffect, useRef } from 'react';
import { doc, setDoc, onSnapshot, collection, query, where, getDocs, deleteDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { EngravingOrder, EngravingStatus } from '../types';
import { Award, Clock, ArrowRight, CheckCircle, RefreshCw, XCircle, Wifi, WifiOff, AlertTriangle, User, Hash, MapPin, Trophy, MessageSquare, ChevronDown } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useAndroidBackHandler } from '../lib/capacitorAndroid';
import DialogSurface from './ui/DialogSurface';

interface CustomerFormProps {
  onBackToRoleSelection: () => void;
  backLabel?: string;
  ownerUid?: string;
  initialRunnerName?: string;
  initialBibNumber?: string;
}

export default function CustomerForm({
  onBackToRoleSelection,
  backLabel = '← Exit Terminal',
  ownerUid,
  initialRunnerName = '',
  initialBibNumber = '',
}: CustomerFormProps) {
  const { can } = useAccess();
  // Navigation / screen states
  const [viewState, setViewState] = useState<'form' | 'confirmed'>('form');
  const [submitting, setSubmitting] = useState(false);
  const [createdOrder, setCreatedOrder] = useState<EngravingOrder | null>(null);

  // Connection co-processing state
  const [lanConnected, setLanConnected] = useState<boolean | null>(null);

  // Form Fields
  const [runnerName, setRunnerName] = useState(initialRunnerName);
  const [bibNumber, setBibNumber] = useState(initialBibNumber);
  const [distance, setDistance] = useState('Marathon');
  const [customDistance, setCustomDistance] = useState('');

  // Robust Finishing Time parts (hours, minutes, seconds selectors to avoid typos)
  const [timeHour, setTimeHour] = useState('02');
  const [timeMin, setTimeMin] = useState('45');
  const [timeSec, setTimeSec] = useState('00');
  const [timeFraction, setTimeFraction] = useState('00000');

  const [rank, setRank] = useState('');
  const [customInscription, setCustomInscription] = useState('');

  // Stats for wait-time estimations
  const [activeQueueCount, setActiveQueueCount] = useState(0);
  const [isQrMaximized, setIsQrMaximized] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [formError, setFormError] = useState('');

  useAndroidBackHandler(isQrMaximized, () => setIsQrMaximized(false));
  useAndroidBackHandler(showCancelConfirm, () => setShowCancelConfirm(false));

  // Firestore Snapshot for live order status update (runners query only own orders per firestore.rules)
  const canViewAllOrders = can('engraving.view');
  const canViewOwnOrders = Boolean(ownerUid) && can('personal.engraving');

  useEffect(() => {
    if (!canViewAllOrders && !canViewOwnOrders) {
      setActiveQueueCount(0);
      return;
    }

    const q = canViewAllOrders
      ? query(collection(db, 'orders'), where('status', 'in', ['queued', 'inprogress']))
      : query(collection(db, 'orders'), where('ownerUid', '==', ownerUid!));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (canViewAllOrders) {
        setActiveQueueCount(snapshot.size);
      } else {
        const count = snapshot.docs.filter((d) => {
          const status = d.data().status;
          return status === 'queued' || status === 'inprogress';
        }).length;
        setActiveQueueCount(count);
      }
    }, (error) => {
      console.error("Queue query failed: ", error);
      handleFirestoreError(error, OperationType.LIST, 'orders');
    });
    return () => unsubscribe();
  }, [canViewAllOrders, canViewOwnOrders, ownerUid]);

  // Listen to live updates of the submitted order when active
  useEffect(() => {
    if (!createdOrder?.id) return;

    const docRef = doc(db, 'orders', createdOrder.id);
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        setCreatedOrder(docSnap.data() as EngravingOrder);
      }
    }, (error) => {
      console.error("Order snapshot listener failed: ", error);
      handleFirestoreError(error, OperationType.GET, `orders/${createdOrder.id}`);
    });
    return () => unsubscribe();
  }, [createdOrder?.id]);

  const createdOrderRef = useRef(createdOrder);
  createdOrderRef.current = createdOrder;

  // Supplement with local LAN polling interval (runs offline when connected to local server)
  useEffect(() => {
    return startLanJsonPoller({
      endpoint: '/api/orders',
      fetcher: authenticatedFetch,
      activeIntervalMs: 2500,
      onData: (payload) => {
        setLanConnected(true);
        const record = (payload && typeof payload === 'object') ? (payload as { orders?: EngravingOrder[] }) : {};
        const localOrdersList: EngravingOrder[] = record.orders || [];

        // 1. Update queue count
        const activeCount = localOrdersList.filter(o => o.status === 'queued' || o.status === 'inprogress').length;
        setActiveQueueCount(activeCount);

        // 2. Update created order status if matching
        const activeCreated = createdOrderRef.current;
        if (activeCreated?.id) {
          const matching = localOrdersList.find(o => o.id === activeCreated.id);
          if (matching && JSON.stringify(matching) !== JSON.stringify(activeCreated)) {
            setCreatedOrder(matching);
          }
        }
      },
      onDisconnected: () => setLanConnected(false),
    });
  }, []);

  // Helper generator of 4-character uppercase code (unique)
  const generateShortCode = (): string => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid ambiguous letters O, I, 0, 1
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  };

  // Submit form data
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!runnerName.trim()) {
      setFormError('Please enter your full name.');
      return;
    }
    if (!bibNumber.trim()) {
      setFormError('Please enter your bib number.');
      return;
    }

    setSubmitting(true);
    try {
      // Assemble core inputs
      const finalDistance = distance === 'Custom' ? (customDistance || 'Custom Run') : distance;
      const formattedTime = `${timeHour.padStart(2, '0')}:${timeMin.padStart(2, '0')}:${timeSec.padStart(2, '0')}${timeFraction.padEnd(5, '0')}`;

      // Determine a unique document ID
      let orderCode = generateShortCode();

      // Perform a fail-fast collision check only when authorized to query collection/orders
      if (canViewAllOrders && typeof navigator !== 'undefined' && navigator.onLine) {
        try {
          const checkQuery = query(collection(db, 'orders'), where('__name__', '==', orderCode));
          const snapshotPromise = getDocs(checkQuery);
          const timeoutPromise = new Promise<any>((_, reject) => setTimeout(() => reject(new Error('uniqueness check timeout')), 450));
          const snapshot = await Promise.race([snapshotPromise, timeoutPromise]);

          if (!snapshot.empty) {
            // Regeneration fallback in case of collision
            orderCode = generateShortCode();
          }
        } catch (getErr) {
          console.warn("Fast uniqueness check bypassed (offline / no internet WAN):", getErr);
        }
      }

      const timestamp = new Date().toISOString();
      const newOrder: EngravingOrder = {
        id: orderCode,
        runnerName: runnerName.trim(),
        bibNumber: bibNumber.trim(),
        distance: finalDistance,
        finishingTime: formattedTime,
        status: 'queued',
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      if (ownerUid) {
        newOrder.ownerUid = ownerUid;
      }
      if (rank.trim()) {
        newOrder.rank = rank.trim();
      }
      if (customInscription.trim()) {
        newOrder.customInscription = customInscription.trim();
      }

      // Write strictly to Firestore in the background (fully non-blocking)
      if (!can('personal.engraving') && !can('engraving.create')) throw new Error('Engraving requests are disabled.');
      await setDoc(doc(db, 'orders', orderCode), newOrder);

      // Simultaneously sync to local LAN backup server in background (fully non-blocking)
      authenticatedFetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newOrder)
      }).then((res) => {
        if (res.ok) console.log("LAN Server sync: Registered new order offline successfully.");
      }).catch((laneErr) => {
        console.warn("LAN Server sync skipped (standalone browser or offline hotspot):", laneErr);
      });

      setCreatedOrder(newOrder);
      setViewState('confirmed');
    } catch (err) {
      console.error("Submission failed: ", err);
      setFormError('Could not submit your medal engraving order. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Cancel order in confirmed screen
  const triggerCancelConfirm = () => {
    setShowCancelConfirm(true);
  };

  const handleExecuteCancelOrder = () => {
    if (!createdOrder) return;

    // Trigger background offline-safe deletions
    deleteDoc(doc(db, 'orders', createdOrder.id)).catch((e) => {
      console.warn("Cloud Firestore delete offline or deferred:", e);
    });

    authenticatedFetch(`/api/orders/${createdOrder.id}`, {
      method: 'DELETE'
    }).catch((laneErr) => {
      console.warn("LAN Server sync delete skipped:", laneErr);
    });

    // Reset UI state instantly (0 milliseconds latency)
    setViewState('form');
    setCreatedOrder(null);
    setShowCancelConfirm(false);
  };

  // Status Stepper Helper
  const getStepStatus = (step: EngravingStatus) => {
    if (!createdOrder) return 'inactive';
    const states: EngravingStatus[] = ['queued', 'inprogress', 'ready', 'completed'];
    const currentIndex = states.indexOf(createdOrder.status);
    const stepIndex = states.indexOf(step);

    if (currentIndex > stepIndex) return 'complete';
    if (currentIndex === stepIndex) return 'current';
    return 'inactive';
  };

  const getStatusDisplayLabel = (status: EngravingStatus) => {
    switch (status) {
      case 'queued': return 'In Engrave Queue';
      case 'inprogress': return 'Laser Engraving In Progress';
      case 'ready': return 'Ready for Pickup!';
      case 'completed': return 'Engraved & Picked Up';
    }
  };

  return (
    <div id="customer_flow_main" className="w-full max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-8 relative">

      {/* Header Bar - frosted glass pill */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between glass-panel hero-glow px-4 sm:px-6 py-4 sm:py-5 mb-8 gap-4 animate-fadeIn">
        <div className="text-left min-w-0">
          <h1 className="heading-float text-2xl sm:text-3xl font-semibold tracking-tight font-display text-[var(--text-primary)]">MEDAL PERSONALIZATION BOOTH</h1>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <p className="text-xs sm:text-sm text-[var(--text-secondary)]">Enter your race details carefully before confirming. Entries sync with the on-site laser station.</p>
            {lanConnected !== null && (
              <span className={`inline-flex items-center gap-2 text-xs font-mono font-semibold tracking-wider uppercase px-3 py-1 rounded-full border ${
                lanConnected
                  ? 'bg-emerald-500/10 border-emerald-600/30 text-emerald-700 dark:text-emerald-400'
                  : 'bg-red-500/10 border-red-600/30 text-red-700 dark:text-red-400'
              } w-max`}>
                <span className={`w-2 h-2 rounded-full ${lanConnected ? 'bg-emerald-600 dark:bg-emerald-400 motion-safe:animate-pulse' : 'bg-red-600 dark:bg-red-400 motion-safe:animate-ping'}`} aria-hidden="true"></span>
                {lanConnected ? (
                  <>
                    <Wifi className="w-3.5 h-3.5" aria-hidden="true" /> LAN Sync Linked
                  </>
                ) : (
                  <>
                    <WifiOff className="w-3.5 h-3.5" aria-hidden="true" /> Standalone Mode
                  </>
                )}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onBackToRoleSelection}
          className="min-h-11 w-full md:w-auto text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] glass-inset hover:bg-[var(--surface-hover)] font-semibold px-4 py-2 transition flex items-center justify-center gap-2 shrink-0"
        >
          {backLabel}
        </button>
      </div>

      {viewState === 'form' ? (
        <div id="order_form_panel" className="grid grid-cols-1 lg:grid-cols-12 gap-8 sm:gap-10 items-start">

          <div className="lg:col-span-7 relative animate-fadeIn">
            <div className="glass-panel p-4 sm:p-8 space-y-6">
              <div className="heading-float-chip flex items-center gap-3 bg-gradient-to-br from-red-700 via-red-800 to-black text-white px-4 py-3 rounded-[20px] border border-white/10">
                <span className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
                  <Award className="w-5 h-5" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <h2 className="heading-float block font-display font-semibold uppercase tracking-widest text-xs sm:text-sm leading-tight">Personalization Form</h2>
                  <p className="block text-xs text-red-100/90 font-normal mt-1">Laser-engraved exactly as typed - double check spelling</p>
                </span>
              </div>

              <form onSubmit={handleSubmit} className="space-y-8" noValidate>

                {/* Section 1: Runner Identity */}
                <div role="group" aria-labelledby="section-runner-identity" className="space-y-4">
                  <div id="section-runner-identity" className="flex items-center gap-2 mb-1">
                    <span className="w-5 h-5 rounded-md bg-red-700/15 dark:bg-red-500/15 text-red-700 dark:text-red-400 flex items-center justify-center text-xs font-semibold shrink-0">1</span>
                    <span className="text-xs font-semibold font-display uppercase tracking-widest text-[var(--text-secondary)]">Runner Identity</span>
                  </div>

                  {/* Name input */}
                  <div id="group_runner_name">
                    <label htmlFor="runnerName" className="block text-xs font-semibold font-display uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                      Full Name <span className="text-red-700 dark:text-red-400">*</span>
                    </label>
                    <div className="relative">
                      <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] pointer-events-none" aria-hidden="true" />
                      <input
                        id="runnerName"
                        type="text"
                        required
                        aria-required="true"
                        placeholder="EX: JUAN DELA CRUZ"
                        value={runnerName}
                        onChange={(e) => setRunnerName(e.target.value.toUpperCase())}
                        className="w-full min-h-11 glass-inset pl-10 pr-4 py-3 text-sm font-semibold text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50 focus:border-red-700/60 transition"
                      />
                    </div>
                    <p className="text-xs text-[var(--text-secondary)] mt-2 pl-1">Exactly as it should appear on the medal.</p>
                  </div>

                  {/* Bib Input */}
                  <div id="group_bib_number">
                    <label htmlFor="bibNumber" className="block text-xs font-semibold font-display uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                      Bib Number <span className="text-red-700 dark:text-red-400">*</span>
                    </label>
                    <div className="relative">
                      <Hash className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] pointer-events-none" aria-hidden="true" />
                      <input
                        id="bibNumber"
                        type="text"
                        required
                        aria-required="true"
                        placeholder="EX: 8842"
                        value={bibNumber}
                        onChange={(e) => setBibNumber(e.target.value.replace(/[^a-zA-Z0-9-]/g, '').toUpperCase())}
                        className="w-full min-h-11 glass-inset pl-10 pr-4 py-3 text-sm font-semibold text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50 focus:border-red-700/60 transition"
                      />
                    </div>
                  </div>
                </div>

                {/* Section 2: Race Details */}
                <div role="group" aria-labelledby="section-race-details" className="space-y-4 pt-6 border-t border-[var(--border-subtle)]">
                  <div id="section-race-details" className="flex items-center gap-2 mb-1">
                    <span className="w-5 h-5 rounded-md bg-red-700/15 dark:bg-red-500/15 text-red-700 dark:text-red-400 flex items-center justify-center text-xs font-semibold shrink-0">2</span>
                    <span className="text-xs font-semibold font-display uppercase tracking-widest text-[var(--text-secondary)]">Race Details</span>
                  </div>

                  {/* Distance Selector */}
                  <div id="group_distance">
                    <label htmlFor="distance" className="block text-xs font-semibold font-display uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                      Race Distance <span className="text-red-700 dark:text-red-400">*</span>
                    </label>
                    <div className="relative">
                      <MapPin className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] pointer-events-none" aria-hidden="true" />
                      <select
                        id="distance"
                        value={distance}
                        onChange={(e) => setDistance(e.target.value)}
                        className="w-full min-h-11 appearance-none glass-inset pl-10 pr-10 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50 focus:border-red-700/60 transition"
                      >
                        <option value="Marathon"> 42KM</option>
                        <option value="Half Marathon">21KM</option>
                        <option value="10K">10KM</option>
                        <option value="5K">5KM</option>
                        <option value="Custom">Custom Distance...</option>
                      </select>
                      <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] pointer-events-none" aria-hidden="true" />
                    </div>
                  </div>

                  {/* Custom Distance text box (only if custom is selected) */}
                  {distance === 'Custom' && (
                    <div id="group_custom_distance">
                      <label htmlFor="customDistance" className="block text-xs font-semibold font-display uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                        Enter Custom Distance Group / Label
                      </label>
                      <input
                        id="customDistance"
                        type="text"
                        required
                        aria-required="true"
                        placeholder="EX: 15K TRAIL RUN or ULTRA 50K"
                        value={customDistance}
                        onChange={(e) => setCustomDistance(e.target.value.toUpperCase())}
                        className="w-full min-h-11 glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50 focus:border-red-700/60 transition animate-fadeIn"
                      />
                    </div>
                  )}

                  {/* Exact Finishing Time Dropdowns - ZERO TYPO DESIGN! */}
                  <div id="group_finish_time">
                    <label className="block text-xs font-semibold font-display uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                      Official Finishing Time <span className="text-red-700 dark:text-red-400">*</span>
                    </label>

                    <div className="flex items-center gap-2 glass-inset p-3">
                      {/* Hours */}
                      <div className="flex-1 min-w-0">
                        <label htmlFor="timeHour" className="block text-xs uppercase tracking-wider font-semibold text-[var(--text-secondary)] text-center mb-1">Hours</label>
                        <select
                          id="timeHour"
                          value={timeHour}
                          onChange={(e) => setTimeHour(e.target.value)}
                          className="w-full min-h-11 bg-[var(--surface-card)]/80 border border-[var(--border-default)] rounded-xl py-2 px-2 text-center font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50 text-sm"
                        >
                          {Array.from({ length: 13 }, (_, i) => String(i).padStart(2, '0')).map(h => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>

                      <span className="text-lg font-semibold text-[var(--text-secondary)] self-end mb-2" aria-hidden="true">:</span>

                      {/* Minutes */}
                      <div className="flex-1 min-w-0">
                        <label htmlFor="timeMin" className="block text-xs uppercase tracking-wider font-semibold text-[var(--text-secondary)] text-center mb-1">Mins</label>
                        <select
                          id="timeMin"
                          value={timeMin}
                          onChange={(e) => setTimeMin(e.target.value)}
                          className="w-full min-h-11 bg-[var(--surface-card)]/80 border border-[var(--border-default)] rounded-xl py-2 px-2 text-center font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50 text-sm"
                        >
                          {Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0')).map(m => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </div>

                      <span className="text-lg font-semibold text-[var(--text-secondary)] self-end mb-2" aria-hidden="true">:</span>

                      {/* Seconds */}
                      <div className="flex-1 min-w-0">
                        <label htmlFor="timeSec" className="block text-xs uppercase tracking-wider font-semibold text-[var(--text-secondary)] text-center mb-1">Secs</label>
                        <select
                          id="timeSec"
                          value={timeSec}
                          onChange={(e) => setTimeSec(e.target.value)}
                          className="w-full min-h-11 bg-[var(--surface-card)]/80 border border-[var(--border-default)] rounded-xl py-2 px-2 text-center font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50 text-sm"
                        >
                          {Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0')).map(s => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <label htmlFor="timeFraction" className="block text-xs mt-2">Fractional seconds (five digits)
                      <input id="timeFraction" inputMode="numeric" pattern="[0-9]{1,5}" maxLength={5} value={timeFraction} onChange={event => setTimeFraction(event.target.value.replace(/[^0-9]/g, '').slice(0, 5))} className="ml-2 w-24 min-h-11 glass-inset p-2 font-mono" />
                    </label>
                    <p className="text-xs text-[var(--text-secondary)] mt-2">Time preview: {timeHour}:{timeMin}:{timeSec}{timeFraction.padEnd(5, '0')}</p>
                  </div>
                </div>

                {/* Section 3: Personalization (optional) */}
                <div role="group" aria-labelledby="section-personalization" className="space-y-4 pt-6 border-t border-[var(--border-subtle)]">
                  <div id="section-personalization" className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="w-5 h-5 rounded-md bg-red-700/15 dark:bg-red-500/15 text-red-700 dark:text-red-400 flex items-center justify-center text-xs font-semibold shrink-0">3</span>
                    <span className="text-xs font-semibold font-display uppercase tracking-widest text-[var(--text-secondary)]">Personalization</span>
                    <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] bg-[var(--surface-hover)] px-2 py-1 rounded-full">Optional</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Rank (Optional) */}
                    <div id="group_rank">
                      <label htmlFor="rank" className="block text-xs font-semibold font-display uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                        Rank / Place
                      </label>
                      <div className="relative">
                        <Trophy className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] pointer-events-none" aria-hidden="true" />
                        <input
                          id="rank"
                          type="text"
                          placeholder="EX: 12 / 2400"
                          value={rank}
                          onChange={(e) => setRank(e.target.value.toUpperCase())}
                          className="w-full min-h-11 glass-inset pl-10 pr-4 py-3 text-sm font-semibold text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50 focus:border-red-700/60 transition"
                        />
                      </div>
                    </div>

                    {/* Inscription (Optional) */}
                    <div id="group_inscription">
                      <label htmlFor="customInscription" className="block text-xs font-semibold font-display uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                        Custom Text
                      </label>
                      <div className="relative">
                        <MessageSquare className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] pointer-events-none" aria-hidden="true" />
                        <input
                          id="customInscription"
                          type="text"
                          placeholder="EX: TEAM NAME"
                          value={customInscription}
                          onChange={(e) => setCustomInscription(e.target.value.toUpperCase())}
                          className="w-full min-h-11 glass-inset pl-10 pr-4 py-3 text-sm font-semibold text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50 focus:border-red-700/60 transition"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {formError && (
                  <p role="alert" className="text-xs font-semibold text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/30 rounded-[var(--radius-control)] px-4 py-3 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>{formError}</span>
                  </p>
                )}

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={submitting}
                  className={`min-h-11 w-full py-4 px-6 rounded-[var(--radius-control)] font-display font-semibold uppercase text-xs tracking-widest shadow-xl flex items-center justify-center gap-2 transition duration-200 ${
                    submitting
                      ? 'bg-[var(--surface-hover)] text-[var(--text-secondary)] cursor-not-allowed'
                      : 'text-white bg-gradient-to-r from-red-700 to-red-800 hover:from-red-600 hover:to-red-700 shadow-red-900/30'
                  }`}
                >
                  {submitting ? (
                    <>
                      <RefreshCw className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" />
                      Connecting & Syncing...
                    </>
                  ) : (
                    <>
                      CONFIRM & REGISTER INSCRIPTION
                      <ArrowRight className="w-4 h-4" aria-hidden="true" />
                    </>
                  )}
                </button>

              </form>
            </div>
          </div>

          {/* Real-time Preview Side */}
          <div className="lg:col-span-1" />
          <div className="lg:col-span-4 lg:sticky lg:top-6 flex flex-col items-center animate-fadeIn">
            <div className="w-full glass-panel p-5 text-left">
              <h3 className="text-xs font-semibold font-display uppercase tracking-widest text-[var(--text-secondary)] border-b border-[var(--border-default)] pb-3 mb-4 flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                Live Engraving Queue Status
              </h3>

              <div className="glass-inset p-4">
                <h4 className="text-xs font-semibold text-[var(--text-primary)] uppercase tracking-wider">Queue Turnaround Estimate</h4>
                <p className="text-xs text-[var(--text-secondary)] mt-2 leading-relaxed">
                  Athletes currently in active queue: <strong className="text-red-700 dark:text-red-400 font-semibold">{activeQueueCount}</strong>.
                </p>
                <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
                  Est. processing latency is <strong className="text-red-700 dark:text-red-400 font-semibold">~{activeQueueCount * 2} minutes</strong>. Submit your registration now to secure your spot in line!
                </p>
              </div>
            </div>
          </div>

        </div>
      ) : (
        /* CONFIRMED STATE / STATUS MONITORING SCREEN */
        <div id="confirmed_screen" className="max-w-4xl mx-auto glass-panel p-4 sm:p-8 text-center space-y-6 sm:space-y-8 animate-fadeIn">

          {/* Confirmed banner */}
          <div className="flex flex-col items-center">
            <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center border border-red-500/20 mb-4 shadow-sm relative">
              <CheckCircle className="w-10 h-10 text-red-700 dark:text-red-400" aria-hidden="true" />
              <span className="absolute -top-1 -right-1 flex h-3 w-3" aria-hidden="true">
                <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-600"></span>
              </span>
            </div>

            <h2 className="heading-float text-2xl sm:text-3xl font-semibold font-display tracking-tight text-[var(--text-primary)] uppercase">Your Medal Inscription is Registered!</h2>
            <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-2 max-w-lg mx-auto">
              We received your customization details safely. Walk to the engraving booth or stand by. This ticket monitor updates in real-time.
            </p>
          </div>

          {/* Ticket ID Box */}
          <div className="max-w-md mx-auto glass-inset py-6 px-3 sm:px-4 relative overflow-x-clip">
            <div className="inline-flex sm:absolute sm:top-0 sm:right-0 py-1 px-3 bg-red-700 font-display font-semibold text-xs tracking-widest text-white rounded-full sm:rounded-none sm:rounded-bl-2xl uppercase mb-2 sm:mb-0">ACTIVE TICKET</div>

            <span className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-widest mb-2">Personalization Code</span>

            {/* Highly readable, separated code display - responsive to never overflow on tiny phones! */}
            <div className="flex flex-wrap items-center justify-center gap-2 my-4">
              {createdOrder?.id.split('').map((char, idx) => (
                <span
                  key={idx}
                  className="w-11 sm:w-14 h-14 sm:h-16 rounded-2xl bg-[var(--surface-card)] border border-[var(--border-default)] flex items-center justify-center text-2xl sm:text-3xl font-mono font-semibold text-red-700 dark:text-red-400 shadow-lg"
                >
                  {char}
                </span>
              ))}
            </div>

            <p className="text-xs text-[var(--text-secondary)] mt-2 font-normal">
              Operator can pull your data instantly on their laptop typing <span className="font-mono bg-[var(--surface-card)] border border-[var(--border-default)] text-red-700 dark:text-red-400 px-2 py-1 rounded-lg text-sm">{createdOrder?.id}</span>. No typing mistakes.
            </p>

            {/* Offline-resilient Sync QR Code Ticket block */}
            <div className="mt-6 pt-5 border-t border-[var(--border-subtle)] flex flex-col items-center">
              <span className="text-xs font-semibold text-red-700 dark:text-red-400 uppercase tracking-widest mb-2 font-sans flex items-center gap-2">
                <WifiOff className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                Offline Ultra-Scan QR Sync
              </span>
              <p className="text-xs text-[var(--text-secondary)] max-w-xs mb-4 text-center leading-relaxed font-sans font-normal">
                No internet on-site? Show this QR to the operator laptop camera. <strong className="text-red-700 dark:text-red-400">Select the QR below to view it full screen</strong> for easier scanning.
              </p>

              <button
                type="button"
                onClick={() => setIsQrMaximized(true)}
                aria-label="Open full-screen sync QR code"
                className="bg-white p-3 sm:p-4 rounded-2xl inline-block shadow-2xl border border-[var(--border-default)] cursor-pointer hover:scale-105 active:scale-95 transition-all duration-200 relative group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
              >
                <span className="absolute inset-0 bg-black/5 opacity-0 group-hover:opacity-100 transition duration-150 rounded-2xl flex items-center justify-center">
                  <span className="bg-black/90 text-white font-mono text-xs py-1 px-2 rounded-lg tracking-wider">TAP TO ZOOM</span>
                </span>
                <QRCodeSVG
                  value={[
                    "RXPv2",
                    createdOrder?.id || 'OFF1',
                    createdOrder?.runnerName || '',
                    createdOrder?.bibNumber || '',
                    createdOrder?.distance || '',
                    formatRaceTime(createdOrder?.finishingTime),
                    createdOrder?.rank || '',
                    createdOrder?.customInscription || ''
                  ].map(val => String(val).replace(/\|/g, " ")).join('|')}
                  size={180}
                  level="M"
                />
              </button>
              <button
                type="button"
                onClick={() => setIsQrMaximized(true)}
                className="min-h-11 px-3 text-xs text-red-700 dark:text-red-400 font-mono mt-2 uppercase tracking-widest font-semibold hover:underline"
              >
                Tap to enlarge full screen
              </button>
              <span className="text-xs text-[var(--text-secondary)] font-mono tracking-wide mt-1">HIGH-CONTRAST QR SYNC TICKET</span>
            </div>

            {/* FULL SCREEN MAXIMIZED QR MODAL */}
            {isQrMaximized && (
              <DialogSurface
                titleId="engraving-qr-zoom-title"
                onRequestClose={() => setIsQrMaximized(false)}
                className="glass-panel p-6 sm:p-8 max-w-md w-full flex flex-col items-center text-center space-y-6 relative"
              >
                <button
                  type="button"
                  onClick={() => setIsQrMaximized(false)}
                  aria-label="Close zoomed QR ticket"
                  className="min-h-11 px-4 py-2 absolute top-4 right-4 glass-inset hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] text-[var(--text-secondary)] text-xs font-mono tracking-wider font-semibold uppercase transition"
                >
                  Close Zoom
                </button>

                <div className="space-y-1 pt-8">
                  <span className="text-xs font-semibold text-red-700 dark:text-red-400 uppercase tracking-widest font-mono flex items-center justify-center gap-2">
                    <WifiOff className="w-4 h-4 text-red-700 dark:text-red-400" aria-hidden="true" />
                    FULL SCREEN SYNC TICKET
                  </span>
                  <h3 id="engraving-qr-zoom-title" className="heading-float text-base font-semibold text-[var(--text-primary)] uppercase font-display tracking-tight">Runner {createdOrder?.runnerName}</h3>
                  <p className="text-xs text-[var(--text-secondary)] max-w-xs leading-normal">
                    Hold your screen directly in front of the laser station camera.
                  </p>
                </div>

                <div className="bg-white p-6 rounded-3xl shadow-2xl border-4 border-red-500/30">
                  <QRCodeSVG
                    value={[
                      "RXPv2",
                      createdOrder?.id || 'OFF1',
                      createdOrder?.runnerName || '',
                      createdOrder?.bibNumber || '',
                      createdOrder?.distance || '',
                      formatRaceTime(createdOrder?.finishingTime),
                      createdOrder?.rank || '',
                      createdOrder?.customInscription || ''
                    ].map(val => String(val).replace(/\|/g, " ")).join('|')}
                    size={280}
                    level="L"
                  />
                </div>

                <div className="glass-inset w-full p-3">
                  <span className="text-xs font-mono text-[var(--text-secondary)] uppercase block tracking-wider mb-1">Engraver Quick Code</span>
                  <span className="text-xl font-mono font-semibold text-red-700 dark:text-red-400 tracking-widest">{createdOrder?.id}</span>
                </div>

                <button
                  type="button"
                  onClick={() => setIsQrMaximized(false)}
                  className="min-h-11 w-full bg-gradient-to-r from-red-700 to-red-800 hover:from-red-600 hover:to-red-700 text-white font-mono font-semibold py-3 rounded-[var(--radius-control)] uppercase text-xs tracking-wider transition shadow-lg shadow-red-900/30"
                >
                  Done Scanning, Back to Status
                </button>
              </DialogSurface>
            )}
          </div>

          {/* Live Status Tracker Stepper */}
          <div className="max-w-2xl mx-auto glass-inset p-6">
            <h3 className="text-xs font-semibold uppercase font-display tracking-widest text-[var(--text-secondary)] mb-6">
              Live Laser Operations Tracker
            </h3>

            {/* Steps bar */}
            <div className="grid grid-cols-4 gap-2 relative">
              {/* Progress Line bar Background */}
              <div className="absolute top-5 left-8 right-8 h-0.5 bg-[var(--surface-hover)] -z-0 rounded"></div>

              {/* Stepper items */}
              {(['queued', 'inprogress', 'ready', 'completed'] as EngravingStatus[]).map((step, idx) => {
                const status = getStepStatus(step);
                return (
                  <div key={step} className="flex flex-col items-center relative z-10">
                    {/* Circle Indicator */}
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center border transition-all duration-200 ${
                      status === 'complete'
                        ? 'bg-emerald-700 border-emerald-700 text-white'
                        : status === 'current'
                        ? 'bg-red-700 border-red-700 text-white font-semibold shadow-lg shadow-red-700/20'
                        : 'bg-[var(--surface-card)] border-[var(--border-default)] text-[var(--text-secondary)]'
                    }`}>
                      {status === 'complete' ? (
                        <span className="font-semibold">✓</span>
                      ) : (
                        <span className="font-mono text-xs">{idx + 1}</span>
                      )}
                    </div>
                    {/* Step label */}
                    <span className={`text-xs font-semibold tracking-wider uppercase mt-2 text-center leading-tight ${
                      status === 'current' ? 'text-red-700 dark:text-red-400' : 'text-[var(--text-secondary)]'
                    }`}>
                      {step === 'queued' ? 'Queued' : step === 'inprogress' ? 'Engraving' : step === 'ready' ? 'Ready' : 'Completed'}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Current State Indicator Alert Message */}
            {createdOrder && (
              <div className="mt-8 bg-[var(--surface-card)]/80 border border-[var(--border-subtle)] rounded-2xl p-4 text-center">
                <span className="text-xs uppercase font-semibold tracking-widest text-[var(--text-secondary)] block mb-1">Queue State Message</span>
                <p className="text-sm font-semibold text-[var(--text-primary)] mt-1 uppercase tracking-wide">
                  {getStatusDisplayLabel(createdOrder.status)}
                </p>
                {createdOrder.status === 'queued' && (
                  <p className="text-xs text-[var(--text-secondary)] mt-2 max-w-sm mx-auto">
                    Operator will retrieve your ticket code shortly. Stay close to the booth area.
                  </p>
                )}
                {createdOrder.status === 'inprogress' && (
                  <p className="text-xs text-[var(--text-secondary)] mt-2 max-w-sm mx-auto">
                    The laser inscriber is active. Your layout is being cut into the physical medal.
                  </p>
                )}
                {createdOrder.status === 'ready' && (
                  <div className="mt-3 flex flex-col items-center justify-center bg-emerald-950/15 dark:bg-emerald-950/30 border border-emerald-700/40 p-3 rounded-xl motion-safe:animate-pulse">
                    <CheckCircle className="w-5 h-5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                    <p className="text-xs text-emerald-800 dark:text-emerald-300 mt-2 font-semibold uppercase tracking-wider">
                      Please Walk up to the engraving operators now to collect!
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Form details confirmation rundown to verify for safety */}
          <div className="max-w-md mx-auto glass-inset p-5 text-left space-y-4">
            <h4 className="text-xs font-semibold font-display uppercase tracking-widest text-[var(--text-secondary)] border-b border-[var(--border-subtle)] pb-3">Registered Inscription Verification</h4>
            <div className="grid grid-cols-2 gap-x-4 gap-y-4 text-xs text-[var(--text-primary)]">
              <div>
                <span className="text-[var(--text-secondary)] text-xs uppercase block mb-1">Name</span>
                <span className="font-semibold text-[var(--text-primary)] truncate block">{createdOrder?.runnerName}</span>
              </div>
              <div>
                <span className="text-[var(--text-secondary)] text-xs uppercase block mb-1">Bib</span>
                <span className="font-mono font-semibold text-[var(--text-primary)] block">{createdOrder?.bibNumber}</span>
              </div>
              <div>
                <span className="text-[var(--text-secondary)] text-xs uppercase block mb-1">Distance</span>
                <span className="font-semibold text-[var(--text-primary)] block">{createdOrder?.distance}</span>
              </div>
              <div>
                <span className="text-[var(--text-secondary)] text-xs uppercase block mb-1">Finishing Time</span>
                <span className="font-mono font-semibold text-[var(--text-primary)] block">{formatRaceTime(createdOrder?.finishingTime)}</span>
              </div>
              {createdOrder?.rank && (
                <div className="col-span-2 border-t border-[var(--border-subtle)] pt-3 mt-1">
                  <span className="text-[var(--text-secondary)] text-xs uppercase block mb-1">Rank</span>
                  <span className="font-semibold text-[var(--text-primary)] block">{createdOrder.rank}</span>
                </div>
              )}
              {createdOrder?.customInscription && (
                <div className="col-span-2 border-t border-[var(--border-subtle)] pt-3">
                  <span className="text-[var(--text-secondary)] text-xs uppercase block mb-1">Custom Inscription</span>
                  <span className="italic text-[var(--text-primary)] block">"{createdOrder.customInscription}"</span>
                </div>
              )}
            </div>
          </div>

          {/* Actions panel */}
          <div className="flex flex-col sm:flex-row justify-center items-center gap-4 pt-6 border-t border-[var(--border-subtle)]">
            <button
              type="button"
              onClick={() => {
                setViewState('form');
                setCreatedOrder(null);
                setRunnerName('');
                setBibNumber('');
                setRank('');
                setCustomInscription('');
              }}
              className="min-h-11 w-full sm:w-auto text-xs font-semibold font-display tracking-widest uppercase text-white bg-gradient-to-r from-red-700 to-red-800 hover:from-red-600 hover:to-red-700 px-6 py-3 rounded-[var(--radius-control)] flex items-center justify-center gap-2 transition shadow-lg shadow-red-900/30"
            >
              <Award className="w-4 h-4" aria-hidden="true" /> REGISTER ANOTHER MEDAL
            </button>
            <button
              type="button"
              onClick={triggerCancelConfirm}
              className="min-h-11 w-full sm:w-auto text-xs font-semibold font-display tracking-widest uppercase text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-400 glass-inset hover:bg-[var(--surface-hover)] px-6 py-3 flex items-center justify-center gap-2 transition"
            >
              <XCircle className="w-4 h-4" aria-hidden="true" /> CANCEL MEDAL REGISTER
            </button>
          </div>

        </div>
      )}

      {/* CUSTOM CONFIRMATION DIALOG FOR CANCEL ORDER */}
      {showCancelConfirm && (
        <DialogSurface
          alert
          titleId="cancel-medal-order-title"
          onRequestClose={() => setShowCancelConfirm(false)}
          className="glass-panel border-red-500/20 p-6 sm:p-8 max-w-md w-full text-center space-y-6 relative"
        >
          <div className="mx-auto w-12 h-12 bg-red-500/10 text-red-700 dark:text-red-400 rounded-full flex items-center justify-center">
            <AlertTriangle className="w-6 h-6" aria-hidden="true" />
          </div>
          <div className="space-y-2">
            <h3 id="cancel-medal-order-title" className="heading-float text-lg font-semibold text-[var(--text-primary)] uppercase tracking-tight">Cancel Medal Registration?</h3>
            <p className="text-xs text-[var(--text-secondary)] lg:text-sm leading-relaxed">
              This cancels and deletes your engraving request immediately.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowCancelConfirm(false)}
              className="min-h-11 w-full glass-inset hover:bg-[var(--surface-hover)] text-[var(--text-primary)] font-semibold py-3 px-4 text-xs uppercase tracking-wider transition"
            >
              No, Keep It
            </button>
            <button
              type="button"
              onClick={handleExecuteCancelOrder}
              className="min-h-11 w-full bg-gradient-to-r from-red-700 to-red-800 hover:from-red-600 hover:to-red-700 text-white font-semibold py-3 px-4 rounded-[var(--radius-control)] text-xs uppercase tracking-wider transition shadow-lg shadow-red-900/30"
            >
              Yes, Cancel Order
            </button>
          </div>
        </DialogSurface>
      )}
    </div>
  );
}

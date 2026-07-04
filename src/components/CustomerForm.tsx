import React, { useState, useEffect } from 'react';
import { doc, setDoc, onSnapshot, collection, query, where, getDocs, deleteDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { EngravingOrder, EngravingStatus } from '../types';
import { Award, Clock, ArrowRight, CheckCircle, RefreshCw, XCircle, Wifi, WifiOff, AlertTriangle, User, Hash, MapPin, Trophy, MessageSquare, ChevronDown } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

interface CustomerFormProps {
  onBackToRoleSelection: () => void;
}

export default function CustomerForm({ onBackToRoleSelection }: CustomerFormProps) {
  // Navigation / screen states
  const [viewState, setViewState] = useState<'form' | 'confirmed'>('form');
  const [submitting, setSubmitting] = useState(false);
  const [createdOrder, setCreatedOrder] = useState<EngravingOrder | null>(null);

  // Connection co-processing state
  const [lanConnected, setLanConnected] = useState<boolean | null>(null);

  // Form Fields
  const [runnerName, setRunnerName] = useState('');
  const [bibNumber, setBibNumber] = useState('');
  const [distance, setDistance] = useState('Marathon');
  const [customDistance, setCustomDistance] = useState('');

  // Robust Finishing Time parts (hours, minutes, seconds selectors to avoid typos)
  const [timeHour, setTimeHour] = useState('02');
  const [timeMin, setTimeMin] = useState('45');
  const [timeSec, setTimeSec] = useState('00');

  const [rank, setRank] = useState('');
  const [customInscription, setCustomInscription] = useState('');

  // Stats for wait-time estimations
  const [activeQueueCount, setActiveQueueCount] = useState(0);
  const [isQrMaximized, setIsQrMaximized] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  // Firestore Snapshot for live order status update
  useEffect(() => {
    // Listen to running queue sizes to dynamic wait estimates
    const q = query(
      collection(db, 'orders'),
      where('status', 'in', ['queued', 'inprogress'])
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setActiveQueueCount(snapshot.size);
    }, (error) => {
      console.error("Queue query failed: ", error);
      handleFirestoreError(error, OperationType.LIST, 'orders');
    });
    return () => unsubscribe();
  }, []);

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

  // Supplement with local LAN polling interval (runs offline when connected to local server)
  useEffect(() => {
    let active = true;
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/orders');
        if (!res.ok) {
          if (active) setLanConnected(false);
          return;
        }
        const data = await res.json();
        if (active) setLanConnected(true);
        const localOrdersList: EngravingOrder[] = data.orders || [];

        // 1. Update queue count
        const activeCount = localOrdersList.filter(o => o.status === 'queued' || o.status === 'inprogress').length;
        if (active) setActiveQueueCount(activeCount);

        // 2. Update created order status if matching
        if (createdOrder?.id) {
          const matching = localOrdersList.find(o => o.id === createdOrder.id);
          if (matching && JSON.stringify(matching) !== JSON.stringify(createdOrder)) {
            if (active) setCreatedOrder(matching);
          }
        }
      } catch (err) {
        if (active) setLanConnected(false);
      }
    }, 2500); // Low-latency 2.5s polling loop for reliable local LAN updates

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [createdOrder]);

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
    if (!runnerName.trim()) return alert('Please enter your full name');
    if (!bibNumber.trim()) return alert('Please enter your Bib Number');

    setSubmitting(true);
    try {
      // Assemble core inputs
      const finalDistance = distance === 'Custom' ? (customDistance || 'Custom Run') : distance;
      const formattedTime = `${timeHour.padStart(2, '0')}:${timeMin.padStart(2, '0')}:${timeSec.padStart(2, '0')}`;

      // Determine a unique document ID
      let orderCode = generateShortCode();

      // Perform a fail-fast, non-blocking single attempt check for online uniqueness
      // If offline or on local LAN with no WAN, proceed instantly with orderCode
      if (typeof navigator !== 'undefined' && navigator.onLine) {
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

      if (rank.trim()) {
        newOrder.rank = rank.trim();
      }
      if (customInscription.trim()) {
        newOrder.customInscription = customInscription.trim();
      }

      // Write strictly to Firestore in the background (fully non-blocking)
      setDoc(doc(db, 'orders', orderCode), newOrder).then(() => {
        console.log("Firestore background write confirmed.");
      }).catch((writeErr) => {
        console.warn("Firestore write queued offline:", writeErr);
      });

      // Simultaneously sync to local LAN backup server in background (fully non-blocking)
      fetch('/api/orders', {
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
      alert("Error submitting order. Please try again.");
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

    fetch(`/api/orders/${createdOrder.id}`, {
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
    <div id="customer_flow_main" className="w-full max-w-6xl mx-auto px-3.5 sm:px-6 py-4 sm:py-8 relative">

      {/* Header Bar - frosted glass pill */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between glass-panel hero-glow px-4 sm:px-6 py-4 sm:py-5 mb-8 gap-4 animate-fadeIn">
        <div className="text-left">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-1.5 justify-start">
            <span className="text-[10px] tracking-widest font-extrabold text-red-500 font-display bg-red-500/10 border border-red-500/20 px-3 py-1 rounded-full uppercase w-max">RacePulsePH by Loud & Clear</span>
            {lanConnected !== null && (
              <span className={`inline-flex items-center gap-1.5 text-[9px] font-mono font-bold tracking-wider uppercase px-2.5 py-1 rounded-full border ${
                lanConnected
                  ? 'bg-green-500/10 border-green-500/25 text-green-500'
                  : 'bg-rose-500/10 border-rose-500/25 text-rose-500'
              } w-max`}>
                <span className={`w-1.5 h-1.5 rounded-full ${lanConnected ? 'bg-green-500 animate-pulse' : 'bg-rose-500 animate-ping'}`}></span>
                {lanConnected ? (
                  <>
                    <Wifi className="w-3 h-3" /> LAN Sync Linked
                  </>
                ) : (
                  <>
                    <WifiOff className="w-3 h-3" /> Standalone Mode
                  </>
                )}
              </span>
            )}
          </div>
          <h1 className="heading-float text-2xl sm:text-3xl font-black tracking-tight font-display text-[var(--text-primary)] mt-1">MEDAL PERSONALIZATION BOOTH</h1>
          <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-1">Configure your personalized medal with zero errors. Submissions sync in real-time to the laser station!</p>
        </div>
        <button
          onClick={onBackToRoleSelection}
          className="w-full md:w-auto text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] glass-inset hover:bg-[var(--surface-hover)] font-bold px-4 py-3 sm:py-2.5 transition flex items-center justify-center gap-2"
        >
          ← Exit Terminal
        </button>
      </div>

      {viewState === 'form' ? (
        <div id="order_form_panel" className="grid grid-cols-1 lg:grid-cols-12 gap-8 sm:gap-10 items-start">

          {/* Form Side - glass card with a floating heading */}
          <div className="lg:col-span-7 relative animate-fadeIn">

            {/* Floating heading badge - overlaps the glass card's top edge, static (no motion) */}
            <div className="absolute -top-6 left-1/2 -translate-x-1/2 z-20">
              <div className="heading-float-chip flex items-center gap-3 bg-gradient-to-br from-red-600 via-red-700 to-black text-white pl-3.5 pr-5 py-3 rounded-[20px] border border-white/10 whitespace-nowrap">
                <span className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
                  <Award className="w-5 h-5" />
                </span>
                <span>
                  <span className="heading-float block font-display font-black uppercase tracking-widest text-xs sm:text-sm leading-none">Personalization Form</span>
                  <span className="block text-[9px] text-red-100/80 font-medium mt-1 normal-case tracking-normal">Laser-engraved exactly as typed - double check spelling</span>
                </span>
              </div>
            </div>

            <div className="glass-panel pt-12 sm:pt-14">
              <form onSubmit={handleSubmit} className="px-4 sm:px-7 pb-6 sm:pb-8 space-y-8" noValidate>

                {/* Section 1: Runner Identity */}
                <div role="group" aria-labelledby="section-runner-identity" className="space-y-4">
                  <div id="section-runner-identity" className="flex items-center gap-2 mb-1">
                    <span className="w-5 h-5 rounded-md bg-red-500/15 text-red-500 flex items-center justify-center text-[10px] font-black shrink-0">1</span>
                    <span className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)]">Runner Identity</span>
                  </div>

                  {/* Name input */}
                  <div id="group_runner_name">
                    <label htmlFor="runnerName" className="block text-xs font-bold font-display uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">
                      Full Name <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <User className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
                      <input
                        id="runnerName"
                        type="text"
                        required
                        aria-required="true"
                        placeholder="EX: JUAN DELA CRUZ"
                        value={runnerName}
                        onChange={(e) => setRunnerName(e.target.value.toUpperCase())}
                        className="w-full glass-inset pl-10 pr-4 py-3.5 text-sm font-semibold text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500/60 transition"
                      />
                    </div>
                    <p className="text-[10.5px] text-[var(--text-muted)] mt-1.5 pl-1">Exactly as it should appear on the medal.</p>
                  </div>

                  {/* Bib Input */}
                  <div id="group_bib_number">
                    <label htmlFor="bibNumber" className="block text-xs font-bold font-display uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">
                      Bib Number <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <Hash className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
                      <input
                        id="bibNumber"
                        type="text"
                        required
                        aria-required="true"
                        placeholder="EX: 8842"
                        value={bibNumber}
                        onChange={(e) => setBibNumber(e.target.value.replace(/[^a-zA-Z0-9-]/g, '').toUpperCase())}
                        className="w-full glass-inset pl-10 pr-4 py-3.5 text-sm font-semibold text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500/60 transition"
                      />
                    </div>
                  </div>
                </div>

                {/* Section 2: Race Details */}
                <div role="group" aria-labelledby="section-race-details" className="space-y-4 pt-6 border-t border-[var(--border-subtle)]">
                  <div id="section-race-details" className="flex items-center gap-2 mb-1">
                    <span className="w-5 h-5 rounded-md bg-red-500/15 text-red-500 flex items-center justify-center text-[10px] font-black shrink-0">2</span>
                    <span className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)]">Race Details</span>
                  </div>

                  {/* Distance Selector */}
                  <div id="group_distance">
                    <label htmlFor="distance" className="block text-xs font-bold font-display uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">
                      Race Distance <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <MapPin className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
                      <select
                        id="distance"
                        value={distance}
                        onChange={(e) => setDistance(e.target.value)}
                        className="w-full appearance-none glass-inset pl-10 pr-10 py-3.5 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500/60 transition"
                      >
                        <option value="Marathon"> 42KM</option>
                        <option value="Half Marathon">21KM</option>
                        <option value="10K">10KM</option>
                        <option value="5K">5KM</option>
                        <option value="Custom">Custom Distance...</option>
                      </select>
                      <ChevronDown className="w-4 h-4 absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
                    </div>
                  </div>

                  {/* Custom Distance text box (only if custom is selected) */}
                  {distance === 'Custom' && (
                    <div id="group_custom_distance">
                      <label htmlFor="customDistance" className="block text-xs font-bold font-display uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">
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
                        className="w-full glass-inset px-4 py-3.5 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500/60 transition animate-fadeIn"
                      />
                    </div>
                  )}

                  {/* Exact Finishing Time Dropdowns - ZERO TYPO DESIGN! */}
                  <div id="group_finish_time">
                    <label className="block text-xs font-bold font-display uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">
                      Official Finishing Time <span className="text-red-500">*</span>
                    </label>

                    <div className="flex items-center gap-2 glass-inset p-3">
                      {/* Hours */}
                      <div className="flex-1">
                        <label htmlFor="timeHour" className="block text-[10px] uppercase tracking-wider font-extrabold text-[var(--text-secondary)] text-center mb-1">Hours</label>
                        <select
                          id="timeHour"
                          value={timeHour}
                          onChange={(e) => setTimeHour(e.target.value)}
                          className="w-full bg-[var(--surface-card)]/80 border border-[var(--border-default)] rounded-xl py-2.5 px-2 text-center font-bold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50 text-sm"
                        >
                          {Array.from({ length: 13 }, (_, i) => String(i).padStart(2, '0')).map(h => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>

                      <span className="text-lg font-bold text-[var(--text-muted)] self-end mb-2">:</span>

                      {/* Minutes */}
                      <div className="flex-1">
                        <label htmlFor="timeMin" className="block text-[10px] uppercase tracking-wider font-extrabold text-[var(--text-secondary)] text-center mb-1">Mins</label>
                        <select
                          id="timeMin"
                          value={timeMin}
                          onChange={(e) => setTimeMin(e.target.value)}
                          className="w-full bg-[var(--surface-card)]/80 border border-[var(--border-default)] rounded-xl py-2.5 px-2 text-center font-bold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50 text-sm"
                        >
                          {Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0')).map(m => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </div>

                      <span className="text-lg font-bold text-[var(--text-muted)] self-end mb-2">:</span>

                      {/* Seconds */}
                      <div className="flex-1">
                        <label htmlFor="timeSec" className="block text-[10px] uppercase tracking-wider font-extrabold text-[var(--text-secondary)] text-center mb-1">Secs</label>
                        <select
                          id="timeSec"
                          value={timeSec}
                          onChange={(e) => setTimeSec(e.target.value)}
                          className="w-full bg-[var(--surface-card)]/80 border border-[var(--border-default)] rounded-xl py-2.5 px-2 text-center font-bold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50 text-sm"
                        >
                          {Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0')).map(s => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <p className="text-[11px] text-[var(--text-secondary)] italic mt-1.5 pl-1">
                      * Dynamic selectors ensure error-free numerical input transfer.
                    </p>
                  </div>
                </div>

                {/* Section 3: Personalization (optional) */}
                <div role="group" aria-labelledby="section-personalization" className="space-y-4 pt-6 border-t border-[var(--border-subtle)]">
                  <div id="section-personalization" className="flex items-center gap-2 mb-1">
                    <span className="w-5 h-5 rounded-md bg-red-500/15 text-red-500 flex items-center justify-center text-[10px] font-black shrink-0">3</span>
                    <span className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)]">Personalization</span>
                    <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)] bg-[var(--surface-hover)] px-2 py-0.5 rounded-full">Optional</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Rank (Optional) */}
                    <div id="group_rank">
                      <label htmlFor="rank" className="block text-xs font-bold font-display uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">
                        Rank / Place
                      </label>
                      <div className="relative">
                        <Trophy className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
                        <input
                          id="rank"
                          type="text"
                          placeholder="EX: 12 / 2400"
                          value={rank}
                          onChange={(e) => setRank(e.target.value.toUpperCase())}
                          className="w-full glass-inset pl-10 pr-4 py-3.5 text-sm font-semibold text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500/60 transition"
                        />
                      </div>
                    </div>

                    {/* Inscription (Optional) */}
                    <div id="group_inscription">
                      <label htmlFor="customInscription" className="block text-xs font-bold font-display uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">
                        Custom Text
                      </label>
                      <div className="relative">
                        <MessageSquare className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
                        <input
                          id="customInscription"
                          type="text"
                          placeholder="EX: TEAM NAME"
                          value={customInscription}
                          onChange={(e) => setCustomInscription(e.target.value.toUpperCase())}
                          className="w-full glass-inset pl-10 pr-4 py-3.5 text-sm font-semibold text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500/60 transition"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={submitting}
                  className={`w-full py-4.5 px-6 rounded-[var(--radius-control)] font-display font-black uppercase text-xs tracking-widest shadow-xl flex items-center justify-center gap-2 transition duration-200 ${
                    submitting
                      ? 'bg-[var(--surface-hover)] text-[var(--text-secondary)] cursor-not-allowed'
                      : 'text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 shadow-red-900/30 hover:shadow-red-800/40 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99]'
                  }`}
                >
                  {submitting ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Connecting & Syncing...
                    </>
                  ) : (
                    <>
                      CONFIRM & REGISTER INSCRIPTION
                      <ArrowRight className="w-4 h-4" />
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
              <h3 className="text-[10px] font-bold font-display uppercase tracking-widest text-[var(--text-secondary)] border-b border-[var(--border-default)] pb-3 mb-4 flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-red-500" />
                Live Engraving Queue Status
              </h3>

              <div className="glass-inset p-4">
                <h4 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">Queue Turnaround Estimate</h4>
                <p className="text-[11px] text-[var(--text-secondary)] mt-2 leading-relaxed">
                  Athletes currently in active queue: <strong className="text-red-500 font-extrabold">{activeQueueCount}</strong>.
                </p>
                <p className="text-[11px] text-[var(--text-secondary)] mt-1 leading-relaxed">
                  Est. processing latency is <strong className="text-red-500 font-extrabold">~{activeQueueCount * 2} minutes</strong>. Submit your registration now to secure your spot in line!
                </p>
              </div>
            </div>
          </div>

        </div>
      ) : (
        /* CONFIRMED STATE / STATUS MONITORING SCREEN */
        <div id="confirmed_screen" className="max-w-4xl mx-auto glass-panel p-4 sm:p-8 md:p-10 text-center space-y-6 sm:space-y-8 animate-fadeIn">

          {/* Confirmed banner */}
          <div className="flex flex-col items-center">
            <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center border border-red-500/20 mb-4 shadow-sm relative">
              <CheckCircle className="w-10 h-10 text-red-500" />
              <span className="absolute -top-1 -right-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
              </span>
            </div>

            <h2 className="heading-float text-2xl sm:text-3xl font-black font-display tracking-tight text-[var(--text-primary)] uppercase">Your Medal Inscription is Registered!</h2>
            <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-2 max-w-lg mx-auto">
              We received your customization details safely. Walk to the engraving booth or stand by. This ticket monitor updates in real-time.
            </p>
          </div>

          {/* Ticket ID Box */}
          <div className="max-w-md mx-auto glass-inset py-6 px-3 sm:px-4 relative overflow-hidden">
            <div className="absolute top-0 right-0 py-1 px-3 bg-red-500 font-display font-black text-[9px] tracking-widest text-black rounded-bl-2xl uppercase">ACTIVE TICKET</div>

            <span className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest mb-1.5">Personalization Code</span>

            {/* Highly readable, separated code display - responsive to never overflow on tiny phones! */}
            <div className="flex items-center justify-center gap-1.5 sm:gap-2.5 my-4">
              {createdOrder?.id.split('').map((char, idx) => (
                <span
                  key={idx}
                  className="w-11 sm:w-14 h-14 sm:h-16 rounded-2xl bg-[var(--surface-card)] border border-[var(--border-default)] flex items-center justify-center text-2xl sm:text-3xl font-mono font-black text-red-500 shadow-lg transform hover:scale-105 duration-200"
                >
                  {char}
                </span>
              ))}
            </div>

            <p className="text-xs text-[var(--text-secondary)] mt-2 font-medium">
              Operator can pull your data instantly on their laptop typing <span className="font-mono bg-[var(--surface-card)] border border-[var(--border-default)] text-red-500 px-1.5 py-1 rounded-lg text-sm">{createdOrder?.id}</span>. No typing mistakes.
            </p>

            {/* Offline-resilient Sync QR Code Ticket block */}
            <div className="mt-6 pt-5 border-t border-[var(--border-subtle)] flex flex-col items-center">
              <span className="text-[10px] font-black text-red-500 uppercase tracking-widest mb-1.5 font-mono flex items-center gap-1.5 font-sans">
                <WifiOff className="w-3.5 h-3.5 text-red-500" />
                Offline Ultra-Scan QR Sync
              </span>
              <p className="text-[10px] text-[var(--text-secondary)] max-w-xs mb-3.5 text-center leading-relaxed font-sans font-medium">
                No internet on-site? Show this QR to the operator's laptop camera. <strong className="text-red-500">Click or tap the QR below to make it full screen</strong> for easier scanning!
              </p>

              <div
                onClick={() => setIsQrMaximized(true)}
                className="bg-white p-3.5 sm:p-4 rounded-2xl inline-block shadow-2xl border border-zinc-200 cursor-pointer hover:scale-105 active:scale-95 transition-all duration-300 relative group"
                title="Click to zoom in full screen"
              >
                <div className="absolute inset-0 bg-black/5 opacity-0 group-hover:opacity-100 transition duration-150 rounded-2xl flex items-center justify-center">
                  <span className="bg-black/90 text-white font-mono text-[9px] py-1 px-2 rounded-lg tracking-wider">🔎 CLICK TO ZOOM</span>
                </div>
                <QRCodeSVG
                  value={[
                    "RXPv2",
                    createdOrder?.id || 'OFF1',
                    createdOrder?.runnerName || '',
                    createdOrder?.bibNumber || '',
                    createdOrder?.distance || '',
                    createdOrder?.finishingTime || '',
                    createdOrder?.rank || '',
                    createdOrder?.customInscription || ''
                  ].map(val => String(val).replace(/\|/g, " ")).join('|')}
                  size={180}
                  level="M"
                />
              </div>
              <span className="text-[10px] text-red-500 font-mono mt-3 uppercase tracking-widest font-extrabold flex items-center gap-1 cursor-pointer" onClick={() => setIsQrMaximized(true)}>
                🔎 TAP TO ENLARGE (FULLSCREEN)
              </span>
              <span className="text-[8.5px] text-[var(--text-muted)] font-mono tracking-wide mt-1">SUPER COMPACT DOT-DENSITY (FAST SCAN)</span>
            </div>

            {/* FULL SCREEN MAXIMIZED QR MODAL */}
            {isQrMaximized && (
              <div
                className="fixed inset-0 bg-black/95 backdrop-blur-xl z-50 flex flex-col items-center justify-center p-4 animate-fadeIn"
                onClick={() => setIsQrMaximized(false)}
              >
                <div
                  className="glass-panel p-8 max-w-md w-full flex flex-col items-center text-center space-y-6 relative"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => setIsQrMaximized(false)}
                    className="absolute top-4 right-4 glass-inset hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] text-[var(--text-secondary)] py-1.5 px-3 text-xs font-mono tracking-wider font-extrabold uppercase transition"
                  >
                    ✕ Close Zoom
                  </button>

                  <div className="space-y-1 pt-4">
                    <span className="text-[11px] font-black text-red-500 uppercase tracking-widest font-mono flex items-center justify-center gap-1.5">
                      <WifiOff className="w-4 h-4 text-red-500" />
                      FULL SCREEN SYNC TICKET
                    </span>
                    <h3 className="heading-float text-md font-bold text-[var(--text-primary)] uppercase font-display tracking-tight">Runner {createdOrder?.runnerName}</h3>
                    <p className="text-[10.5px] text-[var(--text-secondary)] max-w-xs leading-normal">
                      Hold your phone or screen directly in front of the laser station's camera.
                    </p>
                  </div>

                  <div className="bg-white p-6 rounded-3xl shadow-3xl border-4 border-red-500/30">
                    <QRCodeSVG
                      value={[
                        "RXPv2",
                        createdOrder?.id || 'OFF1',
                        createdOrder?.runnerName || '',
                        createdOrder?.bibNumber || '',
                        createdOrder?.distance || '',
                        createdOrder?.finishingTime || '',
                        createdOrder?.rank || '',
                        createdOrder?.customInscription || ''
                      ].map(val => String(val).replace(/\|/g, " ")).join('|')}
                      size={280}
                      level="L"
                    />
                  </div>

                  <div className="glass-inset w-full p-3">
                    <span className="text-[10px] font-mono text-[var(--text-secondary)] uppercase block tracking-wider mb-1">Engraver Quick Code</span>
                    <span className="text-xl font-mono font-black text-red-500 tracking-widest">{createdOrder?.id}</span>
                  </div>

                  <button
                    onClick={() => setIsQrMaximized(false)}
                    className="w-full bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-mono font-black py-3 rounded-[var(--radius-control)] uppercase text-xs tracking-wider transition shadow-lg shadow-red-900/30"
                  >
                    Done Scanning, Back to Status
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Live Status Tracker Stepper */}
          <div className="max-w-2xl mx-auto glass-inset p-6">
            <h3 className="text-[10px] font-bold uppercase font-display tracking-widest text-[var(--text-secondary)] mb-6">
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
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center border transition-all duration-300 ${
                      status === 'complete'
                        ? 'bg-emerald-600 border-emerald-600 text-white'
                        : status === 'current'
                        ? 'bg-red-500 border-red-500 text-white font-extrabold shadow-lg shadow-red-500/20'
                        : 'bg-[var(--surface-card)] border-[var(--border-default)] text-[var(--text-muted)]'
                    }`}>
                      {status === 'complete' ? (
                        <span className="font-bold">✓</span>
                      ) : (
                        <span className="font-mono text-xs">{idx + 1}</span>
                      )}
                    </div>
                    {/* Step label */}
                    <span className={`text-[9px] font-extrabold tracking-wider uppercase mt-2.5 text-center leading-tight ${
                      status === 'current' ? 'text-red-500' : 'text-[var(--text-secondary)]'
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
                <span className="text-[9px] uppercase font-bold tracking-widest text-[var(--text-secondary)] block mb-1">Queue State Message</span>
                <p className="text-sm font-bold text-[var(--text-primary)] mt-0.5 uppercase tracking-wide">
                  {getStatusDisplayLabel(createdOrder.status)}
                </p>
                {createdOrder.status === 'queued' && (
                  <p className="text-xs text-[var(--text-secondary)] mt-1.5 max-w-sm mx-auto">
                    Operator will retrieve your ticket code shortly. Stay close to the booth area.
                  </p>
                )}
                {createdOrder.status === 'inprogress' && (
                  <p className="text-xs text-[var(--text-secondary)] mt-1.5 max-w-sm mx-auto">
                    The laser inscriber is active. Your layout is being cut into the physical medal.
                  </p>
                )}
                {createdOrder.status === 'ready' && (
                  <div className="mt-2.5 flex flex-col items-center justify-center bg-emerald-950/20 border border-emerald-800/40 p-3 rounded-xl animate-pulse">
                    <CheckCircle className="w-5 h-5 text-emerald-500" />
                    <p className="text-xs text-emerald-400 mt-1.5 font-black uppercase tracking-wider">
                      Please Walk up to the engraving operators now to collect!
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Form details confirmation rundown to verify for safety */}
          <div className="max-w-md mx-auto glass-inset p-5 text-left space-y-4">
            <h4 className="text-[10px] font-bold font-display uppercase tracking-widest text-[var(--text-secondary)] border-b border-[var(--border-subtle)] pb-2.5">Registered Inscription Verification</h4>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3.5 text-xs text-[var(--text-primary)]">
              <div>
                <span className="text-[var(--text-secondary)] text-[10px] uppercase block mb-0.5">Name</span>
                <span className="font-extrabold text-[var(--text-primary)] truncate block">{createdOrder?.runnerName}</span>
              </div>
              <div>
                <span className="text-[var(--text-secondary)] text-[10px] uppercase block mb-0.5">Bib</span>
                <span className="font-mono font-extrabold text-[var(--text-primary)] block">{createdOrder?.bibNumber}</span>
              </div>
              <div>
                <span className="text-[var(--text-secondary)] text-[10px] uppercase block mb-0.5">Distance</span>
                <span className="font-bold text-[var(--text-primary)] block">{createdOrder?.distance}</span>
              </div>
              <div>
                <span className="text-[var(--text-secondary)] text-[10px] uppercase block mb-0.5">Finishing Time</span>
                <span className="font-mono font-extrabold text-[var(--text-primary)] block">{createdOrder?.finishingTime}</span>
              </div>
              {createdOrder?.rank && (
                <div className="col-span-2 border-t border-[var(--border-subtle)] pt-2.5 mt-1">
                  <span className="text-[var(--text-secondary)] text-[10px] uppercase block mb-0.5">Rank</span>
                  <span className="font-bold text-[var(--text-primary)] block">{createdOrder.rank}</span>
                </div>
              )}
              {createdOrder?.customInscription && (
                <div className="col-span-2 border-t border-[var(--border-subtle)] pt-2.5">
                  <span className="text-[var(--text-secondary)] text-[10px] uppercase block mb-0.5">Custom Inscription</span>
                  <span className="italic text-[var(--text-primary)] block">"{createdOrder.customInscription}"</span>
                </div>
              )}
            </div>
          </div>

          {/* Actions panel */}
          <div className="flex flex-col sm:flex-row justify-center items-center gap-4 pt-6 border-t border-[var(--border-subtle)]">
            <button
              onClick={() => {
                setViewState('form');
                setCreatedOrder(null);
                setRunnerName('');
                setBibNumber('');
                setRank('');
                setCustomInscription('');
              }}
              className="w-full sm:w-auto text-xs font-bold font-display tracking-widest uppercase text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 px-6 py-3.5 rounded-[var(--radius-control)] flex items-center justify-center gap-1.5 transition shadow-lg shadow-red-900/30"
            >
              <Award className="w-4 h-4" /> REGISTER ANOTHER MEDAL
            </button>
            <button
              onClick={triggerCancelConfirm}
              className="w-full sm:w-auto text-xs font-bold font-display tracking-widest uppercase text-[var(--text-secondary)] hover:text-red-500 glass-inset hover:bg-[var(--surface-hover)] px-6 py-3.5 flex items-center justify-center gap-1.5 transition"
            >
              <XCircle className="w-4 h-4" /> CANCEL MEDAL REGISTER
            </button>
          </div>

        </div>
      )}

      {/* CUSTOM CONFIRMATION DIALOG FOR CANCEL ORDER */}
      {showCancelConfirm && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fadeIn">
          <div className="glass-panel border-red-500/20 p-6 sm:p-8 max-w-md w-full text-center space-y-6 relative">
            <div className="mx-auto w-12 h-12 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-red-500" />
            </div>
            <div className="space-y-2">
              <h3 className="heading-float text-lg font-bold text-[var(--text-primary)] uppercase tracking-tight">Cancel Medal Registration?</h3>
              <p className="text-xs text-[var(--text-secondary)] lg:text-sm leading-relaxed">
                Are you absolutely sure you want to cancel and delete your engraving request? This action is permanent and cannot be undone.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3.5 pt-2">
              <button
                onClick={() => setShowCancelConfirm(false)}
                className="w-full glass-inset hover:bg-[var(--surface-hover)] text-[var(--text-primary)] font-bold py-3 px-4 text-xs uppercase tracking-wider transition active:scale-95"
              >
                No, Keep It
              </button>
              <button
                onClick={handleExecuteCancelOrder}
                className="w-full bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-bold py-3 px-4 rounded-[var(--radius-control)] text-xs uppercase tracking-wider transition active:scale-95 shadow-lg shadow-red-900/30"
              >
                Yes, Cancel Order
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

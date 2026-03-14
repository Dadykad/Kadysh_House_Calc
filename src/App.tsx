import { useState, useEffect, useCallback } from "react";

// --- Constants ---
const TAX_BRACKETS = [
  { limit: 1920000, rate: 0 },
  { limit: 2300000, rate: 0.035 },
  { limit: 5000000, rate: 0.05 },
  { limit: 17000000, rate: 0.08 },
  { limit: Infinity, rate: 0.1 },
];

const RENO_LEVELS = [
  { key: "movein", label: "לעבור לגור", labelEn: "Move-in ready", defaultRate: 0 },
  { key: "cosmetic", label: "קוסמטי", labelEn: "Cosmetic", defaultRate: 1200 },
  { key: "medium", label: "בינוני", labelEn: "Medium", defaultRate: 2500 },
  { key: "deep", label: "עמוק", labelEn: "Deep", defaultRate: 5000 },
  { key: "build", label: "בנייה", labelEn: "Full build", defaultRate: 8000 },
];

type ApartmentStatus = "exists" | "build" | "none";
const APT_LABELS: Record<ApartmentStatus, string> = { exists: "קיימת", build: "לבנות", none: "אין" };

const MAIN_HOUSE_SQM = 130;
const MAMAD_BUILD_COST = 120000;
const APT_SQM = 70;
const MORTGAGE_PAYOFF = 516000;

// --- Types ---
interface ScenarioData {
  id: string;
  name: string;
  salePrice: number;
  additionalEquity: number;
  aptStatus: ApartmentStatus;
  hasMamad: boolean;
  renoSqm: Record<string, number>;
  // Advanced (per-scenario)
  buyerLawyerPct: number;
  brokerPct: number;
  appraiserCost: number;
  inspectionCost: number;
  mortgageAdvisor: number;
  sellerLawyerPct: number;
  sellerBrokerPct: number;
  sellerPrepCost: number;
  sellerRepairs: number;
  sellerAppraiser: number;
  mortgagePerMillion: number;
}


interface ComputedResults {
  maxPropertyPrice: number;
  totalBudget: number;
  grandTotal: number;
  renovationCost: number;
  aptBuildCost: number;
  mamadCost: number;
  mortgageCapacity: number;
  monthlyPayment: number;
  purchaseTax: number;
  sellingCosts: number;
  netFromSale: number;
  buyerLawyer: number;
  buyerBroker: number;
  fixedBuyCosts: number;
}

// --- Helpers ---
function calcPurchaseTax(price: number): number {
  let tax = 0, prev = 0;
  for (const bracket of TAX_BRACKETS) {
    if (price <= prev) break;
    tax += (Math.min(price, bracket.limit) - prev) * bracket.rate;
    prev = bracket.limit;
  }
  return tax;
}

function formatNum(n: number): string {
  return Math.round(n).toLocaleString("he-IL");
}

function computeResults(s: ScenarioData, rates: Record<string, number>): ComputedResults {
  const hasApartment = s.aptStatus !== "none";
  const monthlyPayment = hasApartment ? 10000 : 6000;
  const mortgageMultiplier = 1000000 / s.mortgagePerMillion;
  const mortgageCapacity = monthlyPayment * mortgageMultiplier;

  const sellingCosts =
    s.salePrice * (s.sellerLawyerPct / 100) +
    s.salePrice * (s.sellerBrokerPct / 100) +
    s.sellerPrepCost + s.sellerRepairs + s.sellerAppraiser + MORTGAGE_PAYOFF;

  const netFromSale = s.salePrice - sellingCosts;
  const totalBudget = netFromSale + s.additionalEquity + mortgageCapacity;

  const renovationCost = RENO_LEVELS.reduce(
    (sum, level) => sum + (s.renoSqm[level.key] || 0) * (rates[level.key] || 0), 0
  );
  const aptBuildCost = s.aptStatus === "build" ? APT_SQM * (rates["build"] || 8000) : 0;
  const mamadCost = s.hasMamad ? 0 : MAMAD_BUILD_COST;
  const fixedBuyCosts = s.appraiserCost + s.inspectionCost + s.mortgageAdvisor;

  const budgetForProperty = totalBudget - renovationCost - aptBuildCost - mamadCost - fixedBuyCosts;
  let maxPropertyPrice = 0;
  if (budgetForProperty > 0) {
    let lo = 0, hi = budgetForProperty;
    for (let i = 0; i < 100; i++) {
      const mid = (lo + hi) / 2;
      const cost = mid * (1 + s.buyerLawyerPct / 100 + s.brokerPct / 100) + calcPurchaseTax(mid);
      if (cost <= budgetForProperty) lo = mid; else hi = mid;
    }
    maxPropertyPrice = Math.floor(lo);
  }

  const purchaseTax = calcPurchaseTax(maxPropertyPrice);
  const buyerLawyer = maxPropertyPrice * (s.buyerLawyerPct / 100);
  const buyerBroker = maxPropertyPrice * (s.brokerPct / 100);
  const grandTotal = maxPropertyPrice + buyerLawyer + buyerBroker + purchaseTax + fixedBuyCosts + renovationCost + aptBuildCost + mamadCost;

  return {
    maxPropertyPrice, totalBudget, grandTotal, renovationCost,
    aptBuildCost, mamadCost, mortgageCapacity, monthlyPayment,
    purchaseTax, sellingCosts, netFromSale, buyerLawyer, buyerBroker, fixedBuyCosts,
  };
}

// --- Storage ---
const SCENARIOS_KEY = "kadysh-calc-scenarios-v2";
const RATES_KEY = "kadysh-calc-rates";

function loadScenarios(): ScenarioData[] {
  try { return JSON.parse(localStorage.getItem(SCENARIOS_KEY) || "[]"); } catch { return []; }
}
function persistScenarios(s: ScenarioData[]) { localStorage.setItem(SCENARIOS_KEY, JSON.stringify(s)); }

const DEFAULT_RATES: Record<string, number> = Object.fromEntries(RENO_LEVELS.map((l) => [l.key, l.defaultRate]));

function loadRates(): Record<string, number> {
  try {
    const raw = localStorage.getItem(RATES_KEY);
    return raw ? { ...DEFAULT_RATES, ...JSON.parse(raw) } : { ...DEFAULT_RATES };
  } catch { return { ...DEFAULT_RATES }; }
}
function persistRates(r: Record<string, number>) { localStorage.setItem(RATES_KEY, JSON.stringify(r)); }

// --- Components ---
function NumberInput({ value, onChange, label, suffix, step, inputClassName }: {
  value: number; onChange: (v: number) => void; label?: string; suffix?: string; step?: number; inputClassName?: string;
}) {
  const [raw, setRaw] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setRaw(String(value)); }, [value, focused]);

  return (
    <div>
      {label && <label className="block text-sm font-medium text-slate-600 mb-1">{label}</label>}
      <div className="flex items-center gap-1">
        <input type="number" value={raw} step={step}
          onFocus={() => setFocused(true)}
          onChange={(e) => { setRaw(e.target.value); const n = Number(e.target.value); if (!isNaN(n)) onChange(n); }}
          onBlur={() => { setFocused(false); setRaw(String(value)); }}
          className={inputClassName || "w-full border border-slate-300 rounded-lg px-3 py-2 text-left focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"} dir="ltr" />
        {suffix && <span className="text-sm text-slate-500 whitespace-nowrap">{suffix}</span>}
      </div>
    </div>
  );
}

function defaultScenario(): ScenarioData {
  return {
    id: "", name: "",
    salePrice: 3800000, additionalEquity: 500000,
    aptStatus: "none", hasMamad: true,
    renoSqm: { movein: 130, cosmetic: 0, medium: 0, deep: 0, build: 0 },
    buyerLawyerPct: 0.5, brokerPct: 1.5,
    appraiserCost: 2500, inspectionCost: 3500, mortgageAdvisor: 5000,
    sellerLawyerPct: 0.75, sellerBrokerPct: 1.5,
    sellerPrepCost: 5000, sellerRepairs: 5000, sellerAppraiser: 2500,
    mortgagePerMillion: 5000,
  };
}

// --- Main App ---
export default function App() {
  const [scenarios, setScenarios] = useState<ScenarioData[]>(loadScenarios);
  const [renoRates, setRenoRates] = useState<Record<string, number>>(loadRates);
  const [current, setCurrent] = useState<ScenarioData | null>(null);
  const [newName, setNewName] = useState("");
  const [showNewInput, setShowNewInput] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showRates, setShowRates] = useState(false);
  const [showAdvancedInTable, setShowAdvancedInTable] = useState(false);

  useEffect(() => { persistScenarios(scenarios); }, [scenarios]);
  useEffect(() => { persistRates(renoRates); }, [renoRates]);

  const updateRate = useCallback((key: string, val: number) => {
    setRenoRates((prev) => ({ ...prev, [key]: val }));
  }, []);

  const updateCurrent = useCallback(<K extends keyof ScenarioData>(key: K, val: ScenarioData[K]) => {
    setCurrent((prev) => prev ? { ...prev, [key]: val } : prev);
  }, []);

  function handleNewScenario() {
    if (!newName.trim()) return;
    const s = defaultScenario();
    s.id = Date.now().toString();
    s.name = newName.trim();
    setCurrent(s);
    setNewName("");
    setShowNewInput(false);
  }

  function handleSaveScenario() {
    if (!current) return;
    setScenarios((prev) => {
      const idx = prev.findIndex((s) => s.id === current.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = current; return next; }
      return [...prev, current];
    });
  }

  function handleLoadScenario(s: ScenarioData) {
    setCurrent({ ...s, renoSqm: { ...s.renoSqm } });
  }

  function handleDeleteScenario(id: string) {
    setScenarios((prev) => prev.filter((s) => s.id !== id));
    if (current?.id === id) setCurrent(null);
  }

  const scenarioResults = scenarios.map((s) => ({ scenario: s, results: computeResults(s, renoRates) }));
  const currentResults = current ? computeResults(current, renoRates) : null;
  const r = currentResults;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 py-8 px-4" dir="rtl">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold text-center mb-6 text-slate-800">מחשבון רכישת בית</h1>

        {/* Global Rates */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 mb-4">
          <button onClick={() => setShowRates(!showRates)}
            className="w-full px-6 py-3 text-sm font-medium text-slate-700 flex items-center justify-between hover:bg-slate-50 rounded-2xl transition-colors">
            <span>מחירי בנייה/שיפוץ למ״ר (משותף לכל התרחישים)</span>
            <span className="text-lg">{showRates ? "▲" : "▼"}</span>
          </button>
          {showRates && (
            <div className="px-6 pb-4 space-y-2">
              {RENO_LEVELS.map((level) => (
                <div key={level.key} className="flex items-center gap-3">
                  <div className="w-28 text-sm text-slate-600">
                    {level.label} <span className="text-xs text-slate-400">({level.labelEn})</span>
                  </div>
                  <NumberInput value={renoRates[level.key]} onChange={(v) => updateRate(level.key, v)}
                    suffix="₪/מ״ר" step={100}
                    inputClassName="w-24 border border-slate-300 rounded-lg px-2 py-1.5 text-center text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
              ))}
              <p className="text-xs text-slate-400 pt-1">שינוי מחירים מעדכן את כל התרחישים כולל שמורים</p>
            </div>
          )}
        </section>

        {/* New Scenario / Scenario Header */}
        {!current ? (
          <section className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-5 mb-4 text-center">
            {showNewInput ? (
              <div className="flex gap-2">
                <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleNewScenario()}
                  placeholder="שם התרחיש..."
                  className="flex-1 px-4 py-3 rounded-xl border border-amber-300 text-sm outline-none focus:ring-2 focus:ring-amber-400" autoFocus />
                <button onClick={handleNewScenario}
                  className="px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-bold transition-colors">צור</button>
                <button onClick={() => { setShowNewInput(false); setNewName(""); }}
                  className="px-3 py-3 text-amber-600 hover:bg-amber-100 rounded-xl text-sm transition-colors">ביטול</button>
              </div>
            ) : (
              <button onClick={() => setShowNewInput(true)}
                className="w-full py-4 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-lg font-bold transition-colors shadow-sm">
                + תרחיש חדש
              </button>
            )}
          </section>
        ) : (
          <>
            {/* Active scenario name bar */}
            <section className="bg-blue-600 rounded-2xl p-4 mb-4 flex items-center justify-between text-white">
              <div>
                <div className="text-xs opacity-75">תרחיש פעיל</div>
                <div className="text-xl font-bold">{current.name}</div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { handleSaveScenario(); setCurrent(null); }}
                  className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-xl text-sm font-semibold transition-colors">שמור וסגור</button>
                <button onClick={() => setCurrent(null)}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-sm transition-colors">ביטול</button>
              </div>
            </section>

            {/* Main Inputs */}
            <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mb-4">
              <h2 className="text-lg font-semibold mb-4 text-slate-700">מקורות מימון</h2>
              <div className="grid grid-cols-2 gap-4">
                <NumberInput label="מחיר מכירת הנכס הנוכחי" value={current.salePrice}
                  onChange={(v) => updateCurrent("salePrice", v)} suffix="₪" step={50000} />
                <NumberInput label="הון עצמי נוסף (קה״ש וכו׳)" value={current.additionalEquity}
                  onChange={(v) => updateCurrent("additionalEquity", v)} suffix="₪" step={50000} />
              </div>
              <div className="mt-3 text-sm text-slate-500 flex justify-between">
                <span>החזר משכנתא: {formatNum(r!.monthlyPayment)} ₪/חודש</span>
                <span>יכולת משכנתא: {formatNum(r!.mortgageCapacity)} ₪</span>
              </div>
            </section>

            {/* Apartment Status */}
            <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mb-4">
              <h2 className="text-lg font-semibold mb-4 text-slate-700">יחידת דיור להשכרה</h2>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { value: "exists" as const, label: "קיימת", desc: "מוכנה להשכרה" },
                  { value: "build" as const, label: "לבנות", desc: `${formatNum(APT_SQM * (renoRates["build"] || 8000))} ₪` },
                  { value: "none" as const, label: "אין", desc: "בלי יחידה" },
                ]).map((opt) => (
                  <button key={opt.value} onClick={() => updateCurrent("aptStatus", opt.value)}
                    className={`p-3 rounded-xl border-2 text-center transition-all ${
                      current.aptStatus === opt.value ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 hover:border-slate-300"
                    }`}>
                    <div className="font-medium">{opt.label}</div>
                    <div className="text-xs text-slate-500">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </section>

            {/* Mamad */}
            <section className="bg-white rounded-2xl shadow-sm border border-slate-200 px-6 py-3 mb-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">ממ״ד (מרחב מוגן)</span>
                <div className="flex gap-1.5">
                  {([
                    { value: true, label: "יש" },
                    { value: false, label: `אין (+${formatNum(MAMAD_BUILD_COST)} ₪)` },
                  ]).map((opt) => (
                    <button key={String(opt.value)} onClick={() => updateCurrent("hasMamad", opt.value)}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                        current.hasMamad === opt.value ? "bg-blue-500 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                      }`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            {/* Renovation Allocation */}
            <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mb-4">
              <h2 className="text-lg font-semibold mb-1 text-slate-700">מצב הבית — חלוקת מ״ר</h2>
              {(() => {
                const totalSqm = Object.values(current.renoSqm).reduce((a, b) => a + b, 0);
                return (
                  <p className="text-sm text-slate-500 mb-4">
                    שטח לשיפוץ: {MAIN_HOUSE_SQM} מ״ר | הוקצה: {totalSqm} מ״ר
                    {totalSqm !== MAIN_HOUSE_SQM && (
                      <span className="text-amber-600 font-medium mr-2">
                        ({totalSqm > MAIN_HOUSE_SQM ? "+" : ""}{totalSqm - MAIN_HOUSE_SQM} מ״ר)
                      </span>
                    )}
                  </p>
                );
              })()}
              <div className="space-y-3">
                {RENO_LEVELS.map((level) => (
                  <div key={level.key} className="flex items-center gap-3">
                    <div className="w-28 text-sm font-medium text-slate-600">
                      {level.label}
                      <span className="text-xs text-slate-400 block">{level.labelEn}</span>
                    </div>
                    <div className="w-24">
                      <NumberInput value={current.renoSqm[level.key]}
                        onChange={(v) => updateCurrent("renoSqm", { ...current.renoSqm, [level.key]: v })}
                        suffix="מ״ר" step={5}
                        inputClassName="w-16 border border-slate-300 rounded-lg px-2 py-1.5 text-center text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                    <div className="text-xs text-slate-400">×</div>
                    <div className="text-sm text-slate-500 w-20 text-center" dir="ltr">
                      {formatNum(renoRates[level.key])} ₪
                    </div>
                    <div className="text-sm text-slate-600 font-mono mr-auto" dir="ltr">
                      = {formatNum((current.renoSqm[level.key] || 0) * (renoRates[level.key] || 0))} ₪
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 pt-3 border-t border-slate-200 flex justify-between text-sm font-semibold text-slate-700">
                <span>סה״כ שיפוץ</span>
                <span dir="ltr">{formatNum(r!.renovationCost)} ₪</span>
              </div>
            </section>

            {/* Result */}
            <section className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl shadow-lg p-6 mb-4 text-white">
              <h2 className="text-lg font-semibold mb-2 opacity-90">מחיר נכס מקסימלי</h2>
              <div className="text-5xl font-bold mb-4" dir="ltr">₪ {formatNum(r!.maxPropertyPrice)}</div>

              <div className="grid grid-cols-2 gap-3 text-sm opacity-90">
                <div className="bg-white/10 rounded-xl p-3">
                  <div className="text-xs opacity-75 mb-1">תקציב כולל</div>
                  <div className="font-semibold" dir="ltr">₪ {formatNum(r!.totalBudget)}</div>
                </div>
                <div className="bg-white/10 rounded-xl p-3">
                  <div className="text-xs opacity-75 mb-1">סה״כ הוצאות</div>
                  <div className="font-semibold" dir="ltr">₪ {formatNum(r!.grandTotal)}</div>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-white/20 text-sm space-y-1">
                <div className="flex justify-between"><span>מחיר נכס</span><span dir="ltr">{formatNum(r!.maxPropertyPrice)} ₪</span></div>
                <div className="flex justify-between opacity-75"><span>עו״ד קונה ({current.buyerLawyerPct}%)</span><span dir="ltr">{formatNum(r!.buyerLawyer)} ₪</span></div>
                <div className="flex justify-between opacity-75"><span>תיווך ({current.brokerPct}%)</span><span dir="ltr">{formatNum(r!.buyerBroker)} ₪</span></div>
                <div className="flex justify-between opacity-75"><span>מס רכישה</span><span dir="ltr">{formatNum(r!.purchaseTax)} ₪</span></div>
                <div className="flex justify-between opacity-75"><span>עלויות קבועות</span><span dir="ltr">{formatNum(r!.fixedBuyCosts)} ₪</span></div>
                {r!.renovationCost > 0 && <div className="flex justify-between opacity-75"><span>שיפוץ</span><span dir="ltr">{formatNum(r!.renovationCost)} ₪</span></div>}
                {r!.aptBuildCost > 0 && <div className="flex justify-between opacity-75"><span>בניית יחידת דיור</span><span dir="ltr">{formatNum(r!.aptBuildCost)} ₪</span></div>}
                {r!.mamadCost > 0 && <div className="flex justify-between opacity-75"><span>בניית ממ״ד</span><span dir="ltr">{formatNum(r!.mamadCost)} ₪</span></div>}
                <div className="flex justify-between pt-2 border-t border-white/20 font-semibold"><span>עלויות מכירה + החזר משכנתא</span><span dir="ltr">{formatNum(r!.sellingCosts)} ₪</span></div>
              </div>
            </section>

            {/* Advanced Settings (per scenario) */}
            <section className="bg-white rounded-2xl shadow-sm border border-slate-200 mb-4">
              <button onClick={() => setShowAdvanced(!showAdvanced)}
                className="w-full p-4 text-sm text-slate-500 flex items-center justify-between hover:bg-slate-50 rounded-2xl transition-colors">
                <span>הגדרות מתקדמות (תרחיש זה)</span>
                <span className="text-lg">{showAdvanced ? "▲" : "▼"}</span>
              </button>
              {showAdvanced && (
                <div className="px-6 pb-6 space-y-6">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-600 mb-3">עלויות רכישה</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <NumberInput label="עו״ד קונה (%)" value={current.buyerLawyerPct} onChange={(v) => updateCurrent("buyerLawyerPct", v)} suffix="%" step={0.1} />
                      <NumberInput label="תיווך (%)" value={current.brokerPct} onChange={(v) => updateCurrent("brokerPct", v)} suffix="%" step={0.1} />
                      <NumberInput label="שמאי" value={current.appraiserCost} onChange={(v) => updateCurrent("appraiserCost", v)} suffix="₪" step={500} />
                      <NumberInput label="בדק בית" value={current.inspectionCost} onChange={(v) => updateCurrent("inspectionCost", v)} suffix="₪" step={500} />
                      <NumberInput label="יועץ משכנתאות" value={current.mortgageAdvisor} onChange={(v) => updateCurrent("mortgageAdvisor", v)} suffix="₪" step={500} />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-600 mb-3">עלויות מכירה (נכס נוכחי)</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <NumberInput label="עו״ד מוכר (%)" value={current.sellerLawyerPct} onChange={(v) => updateCurrent("sellerLawyerPct", v)} suffix="%" step={0.1} />
                      <NumberInput label="תיווך מוכר (%)" value={current.sellerBrokerPct} onChange={(v) => updateCurrent("sellerBrokerPct", v)} suffix="%" step={0.1} />
                      <NumberInput label="הכנת נכס למכירה" value={current.sellerPrepCost} onChange={(v) => updateCurrent("sellerPrepCost", v)} suffix="₪" step={1000} />
                      <NumberInput label="תיקונים קלים" value={current.sellerRepairs} onChange={(v) => updateCurrent("sellerRepairs", v)} suffix="₪" step={1000} />
                      <NumberInput label="שמאי מכירה" value={current.sellerAppraiser} onChange={(v) => updateCurrent("sellerAppraiser", v)} suffix="₪" step={500} />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-600 mb-3">משכנתא</h3>
                    <NumberInput label="החזר חודשי לכל מיליון (₪)" value={current.mortgagePerMillion} onChange={(v) => updateCurrent("mortgagePerMillion", v)} suffix="₪/חודש" step={100} />
                    <p className="text-xs text-slate-400 mt-1">ברירת מחדל: 5,000 ₪/חודש למיליון (≈30 שנה)</p>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-600 mb-2">מדרגות מס רכישה (דירה יחידה)</h3>
                    <div className="text-xs text-slate-500 space-y-1">
                      <div>עד 1,920,000: 0%</div>
                      <div>1,920,001 – 2,300,000: 3.5%</div>
                      <div>2,300,001 – 5,000,000: 5%</div>
                      <div>5,000,001 – 17,000,000: 8%</div>
                      <div>מעל 17,000,000: 10%</div>
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* Save bar */}
            <section className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 mb-4 flex gap-2 justify-center">
              <button onClick={() => { handleSaveScenario(); setCurrent(null); }}
                className="px-8 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-base font-bold transition-colors shadow-sm">
                שמור תרחיש
              </button>
              <button onClick={() => setCurrent(null)}
                className="px-6 py-3 text-amber-700 hover:bg-amber-100 rounded-xl text-sm font-medium transition-colors">
                ביטול
              </button>
            </section>

            {/* Funding breakdown */}
            <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mb-4">
              <h2 className="text-lg font-semibold mb-3 text-slate-700">פירוט מימון</h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span>נטו ממכירת נכס</span><span className="font-mono" dir="ltr">{formatNum(r!.netFromSale)} ₪</span></div>
                <div className="flex justify-between text-xs text-slate-500 pr-4"><span>מכירה {formatNum(current.salePrice)} − עלויות {formatNum(r!.sellingCosts)}</span></div>
                <div className="flex justify-between"><span>הון עצמי נוסף</span><span className="font-mono" dir="ltr">{formatNum(current.additionalEquity)} ₪</span></div>
                <div className="flex justify-between"><span>משכנתא ({formatNum(r!.monthlyPayment)} ₪/חודש)</span><span className="font-mono" dir="ltr">{formatNum(r!.mortgageCapacity)} ₪</span></div>
                <div className="flex justify-between pt-2 border-t border-slate-200 font-semibold"><span>סה״כ זמין</span><span className="font-mono" dir="ltr">{formatNum(r!.totalBudget)} ₪</span></div>
              </div>
            </section>
          </>
        )}

        {/* Comparison Table */}
        {scenarioResults.length > 0 && (
          <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mb-4">
            <h2 className="text-lg font-semibold mb-4 text-slate-700">השוואת תרחישים</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-right py-2 pr-2 text-slate-500 font-medium"></th>
                    {scenarioResults.map(({ scenario: s }) => (
                      <th key={s.id} className="text-center py-2 px-2 min-w-[130px]">
                        <div className="font-semibold text-slate-700">{s.name}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-blue-50">
                    <td className="py-2 pr-2 font-semibold text-blue-700">מחיר נכס מקסימלי</td>
                    {scenarioResults.map(({ scenario: s, results: res }) => (
                      <td key={s.id} className="text-center py-2 px-2 font-bold text-blue-700" dir="ltr">{formatNum(res.maxPropertyPrice)} ₪</td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2 pr-2 text-slate-600">תקציב כולל</td>
                    {scenarioResults.map(({ scenario: s, results: res }) => (
                      <td key={s.id} className="text-center py-2 px-2 font-mono text-slate-600" dir="ltr">{formatNum(res.totalBudget)} ₪</td>
                    ))}
                  </tr>
                  <tr className="bg-slate-50">
                    <td className="py-2 pr-2 text-slate-600">משכנתא</td>
                    {scenarioResults.map(({ scenario: s, results: res }) => (
                      <td key={s.id} className="text-center py-2 px-2 font-mono text-slate-600" dir="ltr">
                        {formatNum(res.mortgageCapacity)} ₪
                        <div className="text-xs text-slate-400">{formatNum(res.monthlyPayment)}/חודש</div>
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2 pr-2 text-slate-600">יחידת דיור</td>
                    {scenarioResults.map(({ scenario: s, results: res }) => (
                      <td key={s.id} className="text-center py-2 px-2 text-slate-600">
                        {APT_LABELS[s.aptStatus]}
                        {res.aptBuildCost > 0 && <div className="text-xs text-slate-400" dir="ltr">{formatNum(res.aptBuildCost)} ₪</div>}
                      </td>
                    ))}
                  </tr>
                  <tr className="bg-slate-50">
                    <td className="py-2 pr-2 text-slate-600">ממ״ד</td>
                    {scenarioResults.map(({ scenario: s, results: res }) => (
                      <td key={s.id} className="text-center py-2 px-2 text-slate-600">
                        {s.hasMamad ? "יש" : "לבנות"}
                        {res.mamadCost > 0 && <div className="text-xs text-slate-400" dir="ltr">{formatNum(res.mamadCost)} ₪</div>}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2 pr-2 text-slate-600">שיפוץ</td>
                    {scenarioResults.map(({ scenario: s, results: res }) => (
                      <td key={s.id} className="text-center py-2 px-2 font-mono text-slate-600" dir="ltr">{formatNum(res.renovationCost)} ₪</td>
                    ))}
                  </tr>
                  <tr className="bg-slate-50">
                    <td className="py-2 pr-2 text-slate-600">מס רכישה</td>
                    {scenarioResults.map(({ scenario: s, results: res }) => (
                      <td key={s.id} className="text-center py-2 px-2 font-mono text-slate-600" dir="ltr">{formatNum(res.purchaseTax)} ₪</td>
                    ))}
                  </tr>
                  <tr className="border-t border-slate-200">
                    <td className="py-2 pr-2 font-semibold text-slate-700">סה״כ הוצאות</td>
                    {scenarioResults.map(({ scenario: s, results: res }) => (
                      <td key={s.id} className="text-center py-2 px-2 font-bold text-slate-700" dir="ltr">{formatNum(res.grandTotal)} ₪</td>
                    ))}
                  </tr>

                  {/* Collapsible advanced rows */}
                  <tr>
                    <td colSpan={scenarioResults.length + 1} className="py-1">
                      <button onClick={() => setShowAdvancedInTable(!showAdvancedInTable)}
                        className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1 transition-colors">
                        <span>{showAdvancedInTable ? "▲" : "▼"}</span>
                        <span>פרמטרים מתקדמים</span>
                      </button>
                    </td>
                  </tr>
                  {showAdvancedInTable && (
                    <>
                      <tr className="bg-slate-50">
                        <td className="py-1.5 pr-2 text-xs text-slate-500">עו״ד קונה</td>
                        {scenarioResults.map(({ scenario: s }) => (
                          <td key={s.id} className="text-center py-1.5 px-2 text-xs text-slate-500" dir="ltr">{s.buyerLawyerPct}%</td>
                        ))}
                      </tr>
                      <tr>
                        <td className="py-1.5 pr-2 text-xs text-slate-500">תיווך קונה</td>
                        {scenarioResults.map(({ scenario: s }) => (
                          <td key={s.id} className="text-center py-1.5 px-2 text-xs text-slate-500" dir="ltr">{s.brokerPct}%</td>
                        ))}
                      </tr>
                      <tr className="bg-slate-50">
                        <td className="py-1.5 pr-2 text-xs text-slate-500">שמאי + בדק בית + יועץ</td>
                        {scenarioResults.map(({ scenario: s, results: res }) => (
                          <td key={s.id} className="text-center py-1.5 px-2 text-xs text-slate-500" dir="ltr">{formatNum(res.fixedBuyCosts)} ₪</td>
                        ))}
                      </tr>
                      <tr>
                        <td className="py-1.5 pr-2 text-xs text-slate-500">עו״ד מוכר</td>
                        {scenarioResults.map(({ scenario: s }) => (
                          <td key={s.id} className="text-center py-1.5 px-2 text-xs text-slate-500" dir="ltr">{s.sellerLawyerPct}%</td>
                        ))}
                      </tr>
                      <tr className="bg-slate-50">
                        <td className="py-1.5 pr-2 text-xs text-slate-500">תיווך מוכר</td>
                        {scenarioResults.map(({ scenario: s }) => (
                          <td key={s.id} className="text-center py-1.5 px-2 text-xs text-slate-500" dir="ltr">{s.sellerBrokerPct}%</td>
                        ))}
                      </tr>
                      <tr>
                        <td className="py-1.5 pr-2 text-xs text-slate-500">עלויות מכירה (קבועות)</td>
                        {scenarioResults.map(({ scenario: s }) => (
                          <td key={s.id} className="text-center py-1.5 px-2 text-xs text-slate-500" dir="ltr">
                            {formatNum(s.sellerPrepCost + s.sellerRepairs + s.sellerAppraiser)} ₪
                          </td>
                        ))}
                      </tr>
                      <tr className="bg-slate-50">
                        <td className="py-1.5 pr-2 text-xs text-slate-500">החזר משכנתא למיליון</td>
                        {scenarioResults.map(({ scenario: s }) => (
                          <td key={s.id} className="text-center py-1.5 px-2 text-xs text-slate-500" dir="ltr">{formatNum(s.mortgagePerMillion)} ₪/חודש</td>
                        ))}
                      </tr>
                      <tr>
                        <td className="py-1.5 pr-2 text-xs text-slate-500">עלויות מכירה כולל</td>
                        {scenarioResults.map(({ scenario: s, results: res }) => (
                          <td key={s.id} className="text-center py-1.5 px-2 text-xs font-mono text-slate-500" dir="ltr">{formatNum(res.sellingCosts)} ₪</td>
                        ))}
                      </tr>
                    </>
                  )}

                  <tr>
                    <td className="py-3 pr-2"></td>
                    {scenarioResults.map(({ scenario: s }) => (
                      <td key={s.id} className="text-center py-3 px-2">
                        <div className="flex gap-1 justify-center">
                          <button onClick={() => handleLoadScenario(s)}
                            className="px-2 py-1 text-xs bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors">ערוך</button>
                          <button onClick={() => handleDeleteScenario(s.id)}
                            className="px-2 py-1 text-xs bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors">מחק</button>
                        </div>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        )}

        <footer className="text-center text-xs text-slate-400 pb-8">
          מחשבון תקציב רכישת בית — משפחת קדיש
        </footer>
      </div>
    </div>
  );
}

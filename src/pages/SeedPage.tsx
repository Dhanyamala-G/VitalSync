// ─────────────────────────────────────────────
//  Seed Page — Dev tool to populate Firebase
// ─────────────────────────────────────────────
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Database, CheckCircle, AlertCircle, Play } from 'lucide-react';
import { seedMockData } from '../utils/mockData';
import { Link } from 'react-router-dom';

export default function SeedPage() {
  const [log,     setLog]     = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [done,    setDone]    = useState(false);

  const handleSeed = async () => {
    setRunning(true);
    setLog([]);
    try {
      await seedMockData(msg => setLog(l => [...l, msg]));
      setDone(true);
    } catch (e) {
      setLog(l => [...l, `❌ Error: ${(e as Error).message}`]);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-600 to-brand-900 flex flex-col items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm bg-white rounded-3xl p-6 shadow-2xl"
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-brand-50 rounded-2xl flex items-center justify-center">
            <Database className="w-6 h-6 text-brand-600" />
          </div>
          <div>
            <h1 className="font-bold text-gray-900">Seed Mock Data</h1>
            <p className="text-xs text-gray-500">Populate Firebase for demo</p>
          </div>
        </div>

        <div className="bg-gray-50 rounded-xl p-3 mb-4 text-xs text-gray-600 space-y-1">
          <p className="font-semibold text-gray-700">Will create:</p>
          <p>🏥 4 sample hospitals (Apollo, MIOT, Fortis, GGH)</p>
          <p>🚑 2 ambulances (ALS + BLS)</p>
          <p>👤 1 demo user (Priya Ramesh)</p>
          <p>🚨 1 demo emergency alert</p>
        </div>

        {!done ? (
          <button
            onClick={handleSeed}
            disabled={running}
            className="btn-primary w-full"
          >
            {running ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Seeding…
              </span>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Seed Database
              </>
            )}
          </button>
        ) : (
          <div className="text-center">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-2" />
            <p className="font-bold text-green-700">Seeded Successfully!</p>
            <Link to="/login" className="btn-primary w-full mt-3 inline-flex">
              Go to Login
            </Link>
          </div>
        )}

        {log.length > 0 && (
          <div className="mt-4 bg-gray-900 rounded-xl p-3 max-h-48 overflow-y-auto">
            {log.map((l, i) => (
              <p key={i} className={`text-xs font-mono ${l.startsWith('✅') ? 'text-green-400' : l.startsWith('⚠') ? 'text-yellow-400' : l.startsWith('❌') ? 'text-red-400' : 'text-gray-300'}`}>
                {l}
              </p>
            ))}
          </div>
        )}

        <div className="mt-4 bg-yellow-50 rounded-xl p-3 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-yellow-600 mt-0.5 shrink-0" />
          <p className="text-xs text-yellow-700">
            Run this only once. Requires Firebase to be configured in <code>.env</code>
          </p>
        </div>
      </motion.div>
    </div>
  );
}

import React from 'react';
import { Link } from 'react-router-dom';
import { Menu, X, ExternalLink } from 'lucide-react';
import { shellLine, shellText, shellTextMuted } from '../lib/themeClasses';

const AdminHeader = ({ onToggleSidebar, sidebarOpen }) => (
  <header className={`sticky top-0 z-40 h-14 w-full flex items-center px-4 bg-[color:var(--ex-shell-bg)]/80 backdrop-blur-xl border-b ${shellLine}`}>
    {/* Left: hamburger + title */}
    <div className="flex items-center gap-3 flex-1 min-w-0">
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label="Toggle sidebar"
        className="p-1 rounded-lg text-white/60 hover:text-white hover:bg-white/[0.06] transition-all duration-150"
      >
        {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
      </button>

      <h1 className="text-sm font-semibold tracking-tight truncate">
        <span className={shellText}>DPH</span>{' '}
        <span className="text-emerald-400">Classifieds</span>{' '}
        <span className={shellTextMuted}>Admin</span>
      </h1>
    </div>

    {/* Right: view site link */}
    <div className="flex items-center">
      <Link
        to="/"
        className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition-colors duration-150 px-2 py-1 rounded-lg hover:bg-white/[0.04]"
      >
        <ExternalLink size={12} />
        View site
      </Link>
    </div>
  </header>
);

export default AdminHeader;

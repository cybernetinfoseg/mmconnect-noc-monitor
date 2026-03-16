import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export default function KPICard({ title, value, icon: Icon, color, trend, trendValue }) {
  const colorClasses = {
    blue: 'from-blue-900/30 to-blue-800/20 border-blue-700/40 dark:from-blue-950/60 dark:to-blue-900/40 dark:border-blue-700/50',
    green: 'from-emerald-900/30 to-emerald-800/20 border-emerald-700/40 dark:from-emerald-950/60 dark:to-emerald-900/40 dark:border-emerald-700/50',
    red: 'from-red-900/30 to-red-800/20 border-red-700/40 dark:from-red-950/60 dark:to-red-900/40 dark:border-red-700/50',
    orange: 'from-orange-900/30 to-orange-800/20 border-orange-700/40 dark:from-orange-950/60 dark:to-orange-900/40 dark:border-orange-700/50',
    purple: 'from-purple-900/30 to-purple-800/20 border-purple-700/40 dark:from-purple-950/60 dark:to-purple-900/40 dark:border-purple-700/50',
  };

  const iconColorClasses = {
    blue: 'text-blue-400 dark:text-blue-400 bg-blue-500/15 dark:bg-blue-500/20',
    green: 'text-emerald-400 dark:text-emerald-400 bg-emerald-500/15 dark:bg-emerald-500/20',
    red: 'text-red-400 dark:text-red-400 bg-red-500/15 dark:bg-red-500/20',
    orange: 'text-orange-400 dark:text-orange-400 bg-orange-500/15 dark:bg-orange-500/20',
    purple: 'text-purple-400 dark:text-purple-400 bg-purple-500/15 dark:bg-purple-500/20',
  };

  const valueColorClasses = {
    blue: 'text-blue-400 dark:text-blue-300',
    green: 'text-emerald-400 dark:text-emerald-300',
    red: 'text-red-400 dark:text-red-300',
    orange: 'text-orange-400 dark:text-orange-300',
    purple: 'text-purple-400 dark:text-purple-300',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'relative overflow-hidden rounded-2xl border bg-gradient-to-br p-3 sm:p-6',
        'backdrop-blur-sm transition-all duration-300 hover:shadow-lg dark:hover:shadow-lg/30',
        colorClasses[color] || colorClasses.blue
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1 sm:space-y-2 min-w-0">
          <p className="text-[10px] sm:text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider leading-tight">
            {title}
          </p>
          <motion.p
            key={value}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={cn(
              'text-2xl sm:text-4xl font-bold tracking-tight',
              valueColorClasses[color] || 'text-slate-900'
            )}
          >
            {value}
          </motion.p>
          {trend && (
            <p className={cn(
              'text-[10px] sm:text-xs font-medium hidden sm:block',
              trend === 'up' ? 'text-emerald-500' : 'text-red-500'
            )}>
              {trend === 'up' ? '↑' : '↓'} {trendValue}
            </p>
          )}
        </div>
        <div className={cn(
          'rounded-xl p-2 sm:p-3 shrink-0',
          iconColorClasses[color] || iconColorClasses.blue
        )}>
          <Icon className="h-4 w-4 sm:h-6 sm:w-6" />
        </div>
      </div>
      
      {/* Decorative element */}
      <div className="absolute -right-4 -bottom-4 h-24 w-24 rounded-full bg-current opacity-5" />
    </motion.div>
  );
}
import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export default function KPICard({ title, value, icon: Icon, color, trend, trendValue }) {
  const colorClasses = {
    blue: 'from-blue-500/10 to-blue-600/5 border-blue-500/20',
    green: 'from-emerald-500/10 to-emerald-600/5 border-emerald-500/20',
    red: 'from-red-500/10 to-red-600/5 border-red-500/20',
    orange: 'from-orange-500/10 to-orange-600/5 border-orange-500/20',
    purple: 'from-purple-500/10 to-purple-600/5 border-purple-500/20',
  };

  const iconColorClasses = {
    blue: 'text-blue-500 bg-blue-500/10',
    green: 'text-emerald-500 bg-emerald-500/10',
    red: 'text-red-500 bg-red-500/10',
    orange: 'text-orange-500 bg-orange-500/10',
    purple: 'text-purple-500 bg-purple-500/10',
  };

  const valueColorClasses = {
    blue: 'text-blue-600',
    green: 'text-emerald-600',
    red: 'text-red-600',
    orange: 'text-orange-600',
    purple: 'text-purple-600',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'relative overflow-hidden rounded-2xl border bg-gradient-to-br p-3 sm:p-6',
        'backdrop-blur-sm transition-all duration-300 hover:shadow-lg',
        colorClasses[color] || colorClasses.blue
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1 sm:space-y-2 min-w-0">
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
          <p className="text-[10px] sm:text-sm font-medium text-slate-500 uppercase tracking-wider leading-tight">
            {title}
          </p>
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
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
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-500 uppercase tracking-wider">
            {title}
          </p>
          <motion.p
            key={value}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={cn(
              'text-4xl font-bold tracking-tight',
              valueColorClasses[color] || 'text-slate-900'
            )}
          >
            {value}
          </motion.p>
          {trend && (
            <p className={cn(
              'text-xs font-medium',
              trend === 'up' ? 'text-emerald-500' : 'text-red-500'
            )}>
              {trend === 'up' ? '↑' : '↓'} {trendValue}
            </p>
          )}
        </div>
        <div className={cn(
          'rounded-xl p-3',
          iconColorClasses[color] || iconColorClasses.blue
        )}>
          <Icon className="h-6 w-6" />
        </div>
      </div>
      
      {/* Decorative element */}
      <div className="absolute -right-4 -bottom-4 h-24 w-24 rounded-full bg-current opacity-5" />
    </motion.div>
  );
}
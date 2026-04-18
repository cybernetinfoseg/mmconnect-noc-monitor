import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import moment from 'moment';

export default function LiveClock({ className }) {
  const [time, setTime] = useState(moment());

  useEffect(() => {
    const interval = setInterval(() => {
      setTime(moment());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={className}>
      
      <div className="flex flex-col">
        <p className="text-white text-3xl font-bold tracking-tight tabular-nums">
          {time.format('HH:mm:ss')}
        </p>
        <p className="text-white/60 text-sm uppercase tracking-wider">
          {time.format('dddd, DD MMM YYYY')}
        </p>
      </div>
    </motion.div>);

}
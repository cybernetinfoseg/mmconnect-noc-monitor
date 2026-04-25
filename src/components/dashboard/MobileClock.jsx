import React, { useState, useEffect } from 'react';
import moment from 'moment';
import 'moment/locale/pt';

moment.locale('pt');

export default function MobileClock({ className = '' }) {
  const [time, setTime] = useState(moment());

  useEffect(() => {
    const interval = setInterval(() => setTime(moment()), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className={`flex flex-col items-end leading-none select-none ${className}`}>
      <span className="text-sm font-bold tabular-nums hidden">
        {time.format('HH:mm')}
      </span>
      <span className="text-[10px] opacity-60 hidden">
        {time.format('ddd DD/MM')}
      </span>
    </div>);

}
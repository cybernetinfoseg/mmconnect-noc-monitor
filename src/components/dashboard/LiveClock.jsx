import React, { useState, useEffect } from 'react';
import moment from 'moment';
import 'moment/locale/pt';

moment.locale('pt');

export default function LiveClock({ className = '' }) {
  const [time, setTime] = useState(moment());

  useEffect(() => {
    const interval = setInterval(() => setTime(moment()), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="ml-3 select-none">
      <p className="text-white text-xl font-bold tracking-tight tabular-nums leading-none">
        {time.format('HH:mm:ss')}
      </p>
      <p className="text-white/50 text-[10px] uppercase tracking-wider mt-0.5">
        {time.format('dddd, DD MMM YYYY')}
      </p>
    </div>);

}
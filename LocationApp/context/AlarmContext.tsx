import React, { createContext, useState, useContext } from 'react';
import { Audio } from 'expo-av';

interface AlarmContextType {
  isAlarmActive: boolean;
  setIsAlarmActive: (active: boolean) => void;
  alarmSound: Audio.Sound | null;
  setAlarmSound: (sound: Audio.Sound | null) => void;
}

const AlarmContext = createContext<AlarmContextType | null>(null);

export function AlarmProvider({ children }: { children: React.ReactNode }) {
  const [isAlarmActive, setIsAlarmActive] = useState(false);
  const [alarmSound, setAlarmSound] = useState<Audio.Sound | null>(null);

  const value = {
    isAlarmActive,
    setIsAlarmActive,
    alarmSound,
    setAlarmSound
  };

  return (
    <AlarmContext.Provider value={value}>
      {children}
    </AlarmContext.Provider>
  );
}

export function useAlarm(): AlarmContextType {
  const context = useContext(AlarmContext);
  if (!context) {
    throw new Error('useAlarm must be used within an AlarmProvider');
  }
  return context;
} 
import { useContext } from 'react';
import { HelpContext } from '../context/helpContextObject';

export const useHelp = () => {
  const ctx = useContext(HelpContext);
  if (!ctx) {
    throw new Error('useHelp must be used inside a HelpProvider');
  }
  return ctx;
};

export default useHelp;
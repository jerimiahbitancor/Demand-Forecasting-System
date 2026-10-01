import { useCallback, useMemo, useState } from 'react';
import HelpModal from '../features/components/Help/HelpModal';
import { HelpContext } from './helpContextObject';

export const HelpProvider = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('how-it-works');

  const openHelp = useCallback((tab = 'how-it-works') => {
    setActiveTab(tab);
    setIsOpen(true);
  }, []);

  const closeHelp = useCallback(() => setIsOpen(false), []);

  const value = useMemo(
    () => ({ openHelp, closeHelp }),
    [openHelp, closeHelp]
  );

  return (
    <HelpContext.Provider value={value}>
      {children}
      {isOpen && (
        <HelpModal
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onClose={closeHelp}
        />
      )}
    </HelpContext.Provider>
  );
};

export default HelpProvider;
import { useState, useCallback, useEffect } from 'react';
import AuthScreen from '@/components/screens/AuthScreen';
import ModeSelectScreen from '@/components/screens/ModeSelectScreen';
import OrgChoiceScreen from '@/components/screens/OrgChoiceScreen';
import OrgRegisterScreen from '@/components/screens/OrgRegisterScreen';
import InventorySetupScreen from '@/components/screens/InventorySetupScreen';
import DashboardScreen from '@/components/screens/DashboardScreen';
import DB from '@/lib/database';
import type { User, Organization, BusinessMode } from '@/lib/database';
import { Inv } from '@/lib/services';
import type { Screen } from '@/lib/store';

export default function Index() {
  const [user, setUser] = useState<User | null>(null);
  const [org, setOrg] = useState<Organization | null>(null);
  const [mode, setMode] = useState<BusinessMode | null>(null);
  const [screen, setScreen] = useState<Screen>('auth');

  useEffect(() => {
    const savedUserId = localStorage.getItem('srsis_session_user');
    const savedOrgId = localStorage.getItem('srsis_session_org');
    const savedMode = localStorage.getItem('srsis_session_mode') as BusinessMode | null;
    if (savedUserId) {
      const u = DB.findOne<User>('users', (x: User) => x.id === savedUserId);
      if (u) {
        setUser(u);
        if (savedOrgId && savedMode) {
          const o = DB.findOne<Organization>('businesses', (x: Organization) => x.id === savedOrgId);
          if (o) {
            setOrg(o);
            setMode(savedMode);
            setScreen('dashboard');
            return;
          }
        }
        setScreen('mode_select');
      }
    }
  }, []);

  const onAuth = useCallback((u: User) => {
    setUser(u);
    localStorage.setItem('srsis_session_user', u.id);
    const savedOrgId = localStorage.getItem('srsis_session_org');
    const savedMode = localStorage.getItem('srsis_session_mode') as BusinessMode | null;
    if (savedOrgId && savedMode) {
      const o = DB.findOne<Organization>('businesses', (x: Organization) => x.id === savedOrgId);
      if (o) {
        setOrg(o);
        setMode(savedMode);
        setScreen('dashboard');
        return;
      }
    }
    setScreen('mode_select');
  }, []);

  const onMode = useCallback((m: BusinessMode) => {
    setMode(m);
    localStorage.setItem('srsis_session_mode', m);
    setScreen('org_choice');
  }, []);

  const onSelectOrg = useCallback((o: Organization) => {
    setOrg(o);
    localStorage.setItem('srsis_session_org', o.id);
    const prods = Inv.get(o.id);
    setScreen(prods.length > 0 ? 'dashboard' : 'inventory_setup');
  }, []);

  const onRegisterDone = useCallback((o: Organization) => {
    setOrg(o);
    localStorage.setItem('srsis_session_org', o.id);
    setScreen('inventory_setup');
  }, []);

  const onInventoryDone = useCallback(() => {
    setScreen('dashboard');
  }, []);

  const backToModeSelect = useCallback(() => {
    localStorage.removeItem('srsis_session_org');
    localStorage.removeItem('srsis_session_mode');
    setOrg(null);
    setMode(null);
    setScreen('mode_select');
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('srsis_session_user');
    localStorage.removeItem('srsis_session_org');
    localStorage.removeItem('srsis_session_mode');
    setUser(null);
    setOrg(null);
    setMode(null);
    setScreen('auth');
  }, []);

  return (
    <>
      {screen === 'auth' && <AuthScreen onAuth={onAuth} />}
      {screen === 'mode_select' && <ModeSelectScreen onSelect={onMode} onBack={logout} />}
      {screen === 'org_choice' && user && mode && (
        <OrgChoiceScreen
          userId={user.id}
          mode={mode}
          onSelectOrg={onSelectOrg}
          onRegisterNew={() => setScreen('org_register')}
          onBack={() => setScreen('mode_select')}
        />
      )}
      {screen === 'org_register' && user && mode && (
        <OrgRegisterScreen
          user={user}
          mode={mode}
          onDone={onRegisterDone}
          onBack={() => setScreen('org_choice')}
        />
      )}
      {screen === 'inventory_setup' && org && (
        <InventorySetupScreen
          business={org}
          onDone={onInventoryDone}
          onBack={() => setScreen('org_choice')}
        />
      )}
      {screen === 'dashboard' && user && org && mode && (
        <DashboardScreen
          user={user}
          business={org}
          mode={mode}
          onLogout={logout}
          onBackToModeSelect={backToModeSelect}
          onOrgUpdated={(o) => setOrg(o)}
          onOrgDeleted={() => {
            localStorage.removeItem('srsis_session_org');
            setOrg(null);
            setScreen('org_choice');
          }}
        />
      )}
    </>
  );
}

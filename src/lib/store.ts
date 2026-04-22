import type { User, Organization, BusinessMode } from './database';

export type Screen = 'auth' | 'mode_select' | 'org_choice' | 'org_register' | 'org_select' | 'biz_setup' | 'inventory_setup' | 'dashboard';

export interface AppState {
  user: User | null;
  organization: Organization | null;
  mode: BusinessMode | null;
  screen: Screen;
}

import { defineStore } from 'pinia';

const MOCK_USERS = [
  { id: 1, name: 'Nexora Admin', role: 'Admin', email: 'joecelgarcia1@gmail.com' },
  { id: 2, name: 'Tech Anne', role: 'Staff', email: 'anne@nexora.local' }
];

export const useUsersStore = defineStore({
  id: 'Authuser',
  state: () => ({
    users: {} as any
  }),
  actions: {
    async getAll() {
      this.users = { loading: true };
      setTimeout(() => {
        this.users = MOCK_USERS as any;
      }, 120);
    }
  }
});

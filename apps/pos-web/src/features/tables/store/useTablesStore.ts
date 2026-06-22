import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Table } from '@pos-dian/shared';

interface TablesState {
  selectedRoomId: string | null;
  isCreateRoomModalOpen: boolean;
  isCreateTableModalOpen: boolean;
  activeTableIdForModal: string | null;
  activeTable: Table | null;
  setSelectedRoomId: (id: string | null) => void;
  openCreateRoomModal: () => void;
  closeCreateRoomModal: () => void;
  openCreateTableModal: (roomId?: string) => void;
  closeCreateTableModal: () => void;
  openTableDetails: (tableId: string) => void;
  closeTableDetails: () => void;
  setActiveTable: (table: Table | null) => void;
}

export const useTablesStore = create<TablesState>()(
  persist(
    (set) => ({
      selectedRoomId: null,
      isCreateRoomModalOpen: false,
      isCreateTableModalOpen: false,
      activeTableIdForModal: null,

      setSelectedRoomId: (id) => set({ selectedRoomId: id }),
      
      openCreateRoomModal: () => set({ isCreateRoomModalOpen: true }),
      closeCreateRoomModal: () => set({ isCreateRoomModalOpen: false }),
      
      openCreateTableModal: (roomId) => set({ 
        isCreateTableModalOpen: true, 
        selectedRoomId: roomId || null 
      }),
      closeCreateTableModal: () => set({ isCreateTableModalOpen: false }),

      openTableDetails: (tableId) => set({ activeTableIdForModal: tableId }),
      closeTableDetails: () => set({ activeTableIdForModal: null }),

      activeTable: null,
      setActiveTable: (table) => set({ activeTable: table })
    }),
    {
      name: 'pos-tables-store',
      partialize: (state) => ({ 
        activeTable: state.activeTable,
        selectedRoomId: state.selectedRoomId
      }),
    }
  )
);

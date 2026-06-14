import { create } from 'zustand'

export interface ShotData {
  id: string
  projectId: string
  orderIndex: number
  startTime: number
  endTime: number
  coverUrl: string | null
  scene: string | null
  shotType: string | null
  cameraMove: string | null
  dialogue: Array<{ speaker: string; text: string }>
  audioDesc: string | null
  prompt: string | null
  genStatus: string
  genVideoUrl: string | null
}

interface ShotStore {
  shots: ShotData[]
  editingShot: ShotData | null
  setShots: (shots: ShotData[]) => void
  setEditingShot: (shot: ShotData | null) => void
  updateShot: (id: string, data: Partial<ShotData>) => void
}

export const useShotStore = create<ShotStore>((set) => ({
  shots: [],
  editingShot: null,
  setShots: (shots) => set({ shots }),
  setEditingShot: (shot) => set({ editingShot: shot }),
  updateShot: (id, data) =>
    set((state) => ({
      shots: state.shots.map((s) => (s.id === id ? { ...s, ...data } : s)),
      editingShot:
        state.editingShot?.id === id
          ? { ...state.editingShot, ...data }
          : state.editingShot,
    })),
}))

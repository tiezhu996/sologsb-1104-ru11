import { Navigate, Route, Routes } from 'react-router-dom'
import DiagramEditor from '../pages/DiagramEditor'
import FurnitureIndex from '../pages/FurnitureIndex'
import JointDetail from '../pages/JointDetail'
import JointList from '../pages/JointList'
import StepBoard from '../pages/StepBoard'
import SyncBatchDetail from '../pages/SyncBatchDetail'
import SyncCenter from '../pages/SyncCenter'

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/joints" replace />} />
      <Route path="/joints" element={<JointList />} />
      <Route path="/joints/:id" element={<JointDetail />} />
      <Route path="/joints/:id/steps" element={<StepBoard />} />
      <Route path="/joints/:id/diagram" element={<DiagramEditor />} />
      <Route path="/furniture" element={<FurnitureIndex />} />
      <Route path="/sync" element={<SyncCenter />} />
      <Route path="/sync/batches/:batchId" element={<SyncBatchDetail />} />
      <Route path="*" element={<Navigate to="/joints" replace />} />
    </Routes>
  )
}

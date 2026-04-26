import TitleBar from './TitleBar'
import ActivityBar from './ActivityBar'
import LeftSidebar from './LeftSidebar'
import MainContent from './MainContent'
import RightSidebar from './RightSidebar'
import BottomPanel from './BottomPanel'
import StatusBar from './StatusBar'
import './Shell.css'

export default function Shell() {
  return (
    <div className="shell">
      <div className="shell__titlebar">
        <TitleBar />
      </div>
      <div className="shell__activity">
        <ActivityBar />
      </div>
      <div className="shell__main">
        <div className="shell__center">
          <LeftSidebar />
          <MainContent />
          <RightSidebar />
        </div>
        <BottomPanel />
      </div>
      <div className="shell__status">
        <StatusBar />
      </div>
    </div>
  )
}

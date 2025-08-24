import { useState } from 'react';
import vector from "./assets/vector.svg";
import "./App.css";
import "./style.css";
import ChatAgent from './Components/ChatAgent';

function App() {
  const [activeItem, setActiveItem] = useState('Home');
  const [selectedWorkOpen, setSelectedWorkOpen] = useState(false);
  const [activeSubItem, setActiveSubItem] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [isFocused, setIsFocused] = useState(false);

  const handleSubmit = () => {
    if (query.trim() === "") return;
    setMessages((prev) => [...prev, { role: "user", content: query }]);
    setQuery("");
    setIsFocused(false);
  };

  const menuItems = [
    { label: 'Home' },
    { label: 'Selected Work' },
    { label: 'About Me' },
    { label: 'Testimonies' }
  ];

  const workItems = [
    {
      year: '2025',
      projects: ['Search Global and Module', 'Quote Request Flow for CCP', 'Design System']
    },
    {
      year: '2024 and Older',
      projects: ['Alleo', 'Leave Management System For Drivers (Trucking)', 'MedConnect']
    }
  ];

  return (
    <div className="home">
      {/* Side Panel */}
      <div className="side-panel">
        {menuItems.map((item) => (
          <div key={item.label}>
            <div
              className={`element ${activeItem === item.label ? 'active' : ''}`}
              onClick={() => {
                setActiveItem(item.label);
                if (item.label === 'Selected Work') {
                  setSelectedWorkOpen(prev => !prev);
                } else {
                  setSelectedWorkOpen(false);
                }
              }}
            >
              <div className="text-wrapper">{item.label}</div>
            </div>

            {item.label === 'Selected Work' && selectedWorkOpen && (
              <div className="selected-work">
                {workItems.map(group => (
                  <div className="div" key={group.year}>
                    <div className="text-wrapper-2">{group.year}</div>
                    {group.projects.map(proj => (
                      <div
                        key={proj}
                        className={`submenu-item ${activeSubItem === proj ? 'active' : ''}`}
                        onClick={() => setActiveSubItem(proj)}
                      >
                        {proj}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Right Side */}
      <div className="right-side">
        <div className="chat-wrapper">
          {/* Intro shows until first message */}
          {messages.length === 0 && (
            <div className="intro">
              <p className="hi-i-m-keerti-a">
                Hi, I&#39;m Keerti — a product designer and Developer
              </p>
              <p className="p">Meet Kairo, my AI agent.</p>
              <div className="ellipse" />
              <p className="she-ll-help-you">
                She’ll help you explore my work, skills, and story.<br/>
                Just ask her anything.
              </p>
            </div>
          )}

          {/* Chat messages */}
          <ChatAgent messages={messages} setMessages={setMessages} />

          {/* Textbox always fixed at bottom */}
          <div className="textbox">
            <input
              type="text"
              className="text-input"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(query !== "")}
              placeholder={isFocused ? "" : "Eg. Keerti’s recent work, her design process etc..."}
              onKeyDown={e => { if (e.key === "Enter") handleSubmit(); }}
            />
            <div
              className="arrow"
              onClick={handleSubmit}
              role="button"
              tabIndex={0}
              aria-label="Send message"
            >
              <img className="vector" alt="Vector" src={vector} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;

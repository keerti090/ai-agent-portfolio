// import { useState } from 'react';
// import vector from "./assets/vector.svg";
// import pic from "./assets/pic.jpg";
// import "./App.css";
// import "./style.css";
// import ChatAgent from './Components/ChatAgent';

// function App() {
//   const [activeItem, setActiveItem] = useState('Home');
//   const [selectedWorkOpen, setSelectedWorkOpen] = useState(false);
//   const [activeSubItem, setActiveSubItem] = useState<string | null>(null);

//   const [query, setQuery] = useState("");
//   const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
//   const [isFocused, setIsFocused] = useState(false);

//   const handleSubmit = () => {
//     if (query.trim() === "") return;
//     setMessages((prev) => [...prev, { role: "user", content: query }]);
//     setQuery("");
//     setIsFocused(false);
//   };

//   const menuItems = [
//     { label: 'Home' },
//     { label: 'Selected Work' },
//     { label: 'About Me' },
//     { label: 'Testimonies' }
//   ];

//   const workItems = [
//     {
//       year: '2025',
//       projects: ['Search Global and Module', 'Quote Request Flow for CCP', 'Design System']
//     },
//     {
//       year: '2024 and Older',
//       projects: ['Alleo', 'Leave Management System For Drivers (Trucking)', 'MedConnect']
//     }
//   ];

//   return (
//     <div className="home">
//       {/* Side Panel */}
//       <div className="side-panel">
//         {menuItems.map((item) => (
//           <div key={item.label}>
//             <div
//               className={`element ${activeItem === item.label ? 'active' : ''}`}
//               onClick={() => {
//                 setActiveItem(item.label);
//                 if (item.label === 'Selected Work') {
//                   setSelectedWorkOpen(prev => !prev);
//                 } else {
//                   setSelectedWorkOpen(false);
//                 }
//               }}
//             >
//               <div className="text-wrapper">{item.label}</div>
//             </div>

//             {item.label === 'Selected Work' && selectedWorkOpen && (
//               <div className="selected-work">
//                 {workItems.map(group => (
//                   <div className="div" key={group.year}>
//                     <div className="text-wrapper-2">{group.year}</div>
//                     {group.projects.map(proj => (
//                       <div
//                         key={proj}
//                         className={`submenu-item ${activeSubItem === proj ? 'active' : ''}`}
//                         onClick={() => setActiveSubItem(proj)}
//                       >
//                         {proj}
//                       </div>
//                     ))}
//                   </div>
//                 ))}
//               </div>
//             )}
//           </div>
//         ))}
//       </div>

//       {/* Right Side */}
//       <div className="right-side">
//         <div className="chat-wrapper">
//           {/* Intro shows until first message */}
//           {messages.length === 0 && (
//             <div className="intro">
//               <p className="hi-i-m-keerti-a">
//                 Hi, I&#39;m Keerti — a product designer and Developer
//               </p>
//               <p className="p">Meet Kairo, my AI agent.</p>
//               <div className="ellipse">
//                 <img src={pic} alt='pic' className='mypic' />
//                 </div>
//               <p className="she-ll-help-you">
//                 She’ll help you explore my work, skills, and story.<br/>
//                 Just ask her anything.
//               </p>
//             </div>
//           )}

//           {/* Chat messages */}
//           <ChatAgent messages={messages} setMessages={setMessages} />

//           {/* Textbox always fixed at bottom */}
//           <div className="textbox">
//             <input
//               type="text"
//               className="text-input"
//               value={query}
//               onChange={e => setQuery(e.target.value)}
//               onFocus={() => setIsFocused(true)}
//               onBlur={() => setIsFocused(query !== "")}
//               placeholder={isFocused ? "" : "Eg. Keerti’s recent work, her design process etc..."}
//               onKeyDown={e => { if (e.key === "Enter") handleSubmit(); }}
//             />
//             <div
//               className="arrow"
//               onClick={handleSubmit}
//               role="button"
//               tabIndex={0}
//               aria-label="Send message"
//             >
//               <img className="vector" alt="Vector" src={vector} />
//             </div>
//           </div>
//         </div>
//       </div>
//     </div>
//   );
// }

// export default App;
import { useState, useEffect } from 'react';
import vector from "./assets/vector.svg";
import pic from "./assets/pic.jpg";
import "./App.css";
import "./style.css";
import ChatAgent from './Components/ChatAgent';

function App() {
  const [activeItem, setActiveItem] = useState("Home");
  const [selectedWorkOpen, setSelectedWorkOpen] = useState(false);
  const [activeSubItem, setActiveSubItem] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [showHero, setShowHero] = useState(true);

  const handleSuggestion = (q: string) => {
    setMessages(prev => [...prev, { role: "user", content: q }]);
    setShowHero(false);
  };

  const handleSubmit = () => {
    if (!query.trim()) return;
    setMessages(prev => [...prev, { role: "user", content: query }]);
    setQuery("");
    setShowHero(false);
  };

  // Send automatic greeting message from Kairo
  useEffect(() => {
    const timer = setTimeout(() => {
      if (messages.length === 0) {
        setMessages([
          {
            role: "assistant",
            content: "Hi! I’m Kairo — Keerti’s AI agent 👋\nI can walk you through her case studies, skills, and design impact.\nWhat would you like to explore first?"
          }
        ]);
      }
    }, 1200);
    return () => clearTimeout(timer);
  }, []);

  const menuItems = [
    { label: "Home" },
    { label: "Selected Work" },
    { label: "About Me" },
    { label: "Testimonies" }
  ];

  const workItems = [
    {
      year: "2025",
      projects: ["Search Global and Module", "Quote Request Flow", "Design System"]
    },
    {
      year: "2024 and Older",
      projects: ["Zentra - Property Management", "Leave Management System", "WomanAid"]
    }
  ];

  const quickSuggestions = [
    "Show Keerti’s latest case study",
    "What are her design strengths?",
    "Show Cloud Commerce projects",
    "What impact has Keerti made?",
    "What is Keerti’s design process?"
  ];

  return (
    <div className="home">
      {/* Left Navigation */}
      <div className="side-panel">
        {menuItems.map(item => (
          <div key={item.label}>
            <div
              className={`element ${activeItem === item.label ? "active" : ""}`}
              onClick={() => {
                setActiveItem(item.label);
                setSelectedWorkOpen(item.label === "Selected Work" ? !selectedWorkOpen : false);
              }}
            >
              {item.label}
            </div>

            {item.label === "Selected Work" && selectedWorkOpen && (
              <div className="selected-work">
                {workItems.map(group => (
                  <div key={group.year}>
                    <div className="text-wrapper-2">{group.year}</div>
                    {group.projects.map(project => (
                      <div
                        key={project}
                        className={`submenu-item ${
                          activeSubItem === project ? "active" : ""
                        }`}
                        onClick={() => setActiveSubItem(project)}
                      >
                        {project}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Main Content */}
      <div className="right-side">
        <div className="chat-wrapper">

          {/* Hero only when Kairo message hasn't been responded to */}
          {showHero && (
            <div className="intro-centered">
              <img src={pic} alt="Keerti" className="hero-pic" />

              <h1 className="hero-title">Hi 👋, I'm Keerti</h1>
              <p className="hero-subtitle">Product Designer & Developer</p>

              <p className="hero-description">
                I design intelligent B2B XaaS experiences for Cloud Commerce platforms.
              </p>

              <p className="hero-kairo-text">
                Kairo will help you explore my work, skills, and story.
              </p>
              
              <p className="suggestion-label">Try asking about…</p>

              <div className="suggestion-chips">
                {quickSuggestions.map((text, index) => (
                  <button
                    key={index}
                    className="chip"
                    onClick={() => handleSuggestion(text)}
                  >
                    {text}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Conversation */}
         
          {/* Chat Input */}
          <div className="textbox">
            <input
              type="text"
              className="text-input"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSubmit()}
              placeholder="Ask about Keerti’s latest project..."
            />
            <button className="arrow" onClick={handleSubmit}>
              <img src={vector} alt="send" className="vector" />
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}

export default App;

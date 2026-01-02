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
import vector from "./assets/Vector.svg";
import pic from "./assets/pic.jpg";
import "./App.css";
import "./style.css";
import ChatAgent from './Components/ChatAgent';
import { apiUrl } from "./lib/api";

function App() {
  const [activeItem, setActiveItem] = useState("Home");
  const [selectedWorkOpen, setSelectedWorkOpen] = useState(false);
  const [activeSubItem, setActiveSubItem] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [showHero, setShowHero] = useState(true);
  const aboutMeUrl = "https://keertis-dapper-site.webflow.io/about";
  const linkedInUrl = "https://www.linkedin.com/in/keertihegde/";

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
  }, [messages.length]);

  // Close the mobile drawer when switching to desktop layout.
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 900px)");
    const handleChange = (e: MediaQueryListEvent) => {
      if (!e.matches) setMobileNavOpen(false);
    };
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", handleChange);
      return () => mql.removeEventListener("change", handleChange);
    }
    // Safari fallback
    mql.addListener(handleChange);
    return () => mql.removeListener(handleChange);
  }, []);

  // ESC closes the drawer.
  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileNavOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileNavOpen]);

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

  const kebabLabel = mobileNavOpen ? "Close menu" : "Open menu";

  // Preview links for case studies.
  // 2024 work should take users to the Webflow preview pages.
  const projectPreviewLinks: Record<string, string> = {
    // 2025 (served by backend)
    "Search Global and Module": apiUrl("/case-studies/search"),

    // 2024 (Webflow previews)
    "Zentra - Property Management": "https://preview.webflow.com/preview/keertis-dapper-site?utm_medium=preview_link&utm_source=designer&utm_content=keertis-dapper-site&preview=193a28b12b9c763d9cdcb272279c9787&pageId=66031f7d5fe1526d39ea7fc6&workflow=sitePreview",
    "Leave Management System": "https://preview.webflow.com/preview/keertis-dapper-site?utm_medium=preview_link&utm_source=designer&utm_content=keertis-dapper-site&preview=193a28b12b9c763d9cdcb272279c9787&pageId=6518acd461008515c9c8a4df&workflow=sitePreview",
    "WomanAid": "https://preview.webflow.com/preview/keertis-dapper-site?utm_medium=preview_link&utm_source=designer&utm_content=keertis-dapper-site&preview=193a28b12b9c763d9cdcb272279c9787&pageId=638a46d51451a314feb98373&workflow=sitePreview",
  };

  const openPreviewLink = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const goToAboutMe = () => {
    window.location.assign(aboutMeUrl);
  };

  const goToLinkedIn = () => {
    window.open(linkedInUrl, "_blank", "noopener,noreferrer");
  };

  const renderNavItems = (opts?: { inDrawer?: boolean }) => (
    <>
      {menuItems.map(item => (
        <div key={item.label}>
          <div
            className={`element ${activeItem === item.label ? "active" : ""}`}
            onClick={() => {
              if (item.label === "About Me") {
                if (opts?.inDrawer) setMobileNavOpen(false);
                goToAboutMe();
                return;
              }
              if (item.label === "Testimonies") {
                setActiveItem(item.label);
                if (opts?.inDrawer) setMobileNavOpen(false);
                goToLinkedIn();
                return;
              }
              setActiveItem(item.label);
              setSelectedWorkOpen(item.label === "Selected Work" ? !selectedWorkOpen : false);
              if (opts?.inDrawer) setMobileNavOpen(false);
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              if (item.label === "About Me") {
                if (opts?.inDrawer) setMobileNavOpen(false);
                goToAboutMe();
                return;
              }
              if (item.label === "Testimonies") {
                setActiveItem(item.label);
                if (opts?.inDrawer) setMobileNavOpen(false);
                goToLinkedIn();
                return;
              }
              setActiveItem(item.label);
              setSelectedWorkOpen(item.label === "Selected Work" ? !selectedWorkOpen : false);
              if (opts?.inDrawer) setMobileNavOpen(false);
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
                      className={`submenu-item ${activeSubItem === project ? "active" : ""}`}
                      onClick={() => {
                        setActiveSubItem(project);
                        const previewUrl = projectPreviewLinks[project];
                        if (previewUrl) openPreviewLink(previewUrl);
                        if (opts?.inDrawer) setMobileNavOpen(false);
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter" && e.key !== " ") return;
                        setActiveSubItem(project);
                        const previewUrl = projectPreviewLinks[project];
                        if (previewUrl) openPreviewLink(previewUrl);
                        if (opts?.inDrawer) setMobileNavOpen(false);
                      }}
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
    </>
  );

  return (
    <div className="home">
      {/* Left Navigation */}
      <div className="side-panel">
        {renderNavItems()}
      </div>

      {/* Main Content */}
      <div className="right-side">
        <div className="chat-wrapper">

          {/* Mobile kebab (top-left) */}
          <button
            className="mobile-kebab"
            type="button"
            aria-label={kebabLabel}
            aria-expanded={mobileNavOpen}
            aria-controls="mobile-nav"
            onClick={() => setMobileNavOpen(v => !v)}
          >
            <span className="mobile-kebab-icon" aria-hidden="true">
            <svg width="22"  height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="3" y="6" width="18" height="2" rx="1" fill="currentColor" />
  <rect x="3" y="11" width="18" height="2" rx="1" fill="currentColor" />
  <rect x="3" y="16" width="18" height="2" rx="1" fill="currentColor" />
</svg>
            </span>
          </button>

          {/* Mobile Drawer */}
          {mobileNavOpen && (
            <div className="mobile-nav-layer" role="presentation">
              <button
                type="button"
                className="mobile-nav-backdrop"
                aria-label="Close menu"
                onClick={() => setMobileNavOpen(false)}
              />
              <aside id="mobile-nav" className="mobile-nav-drawer" role="dialog" aria-modal="true" aria-label="Navigation">
                <div className="mobile-nav-header">
                  <div className="mobile-nav-title">Menu</div>
                  <button
                    type="button"
                    className="mobile-nav-close"
                    aria-label="Close menu"
                    onClick={() => setMobileNavOpen(false)}
                  >
                    ✕
                  </button>
                </div>
                <div className="side-panel mobile-side-panel">
                  {renderNavItems({ inDrawer: true })}
                </div>
              </aside>
            </div>
          )}

          {/* Hero only when Kairo message hasn't been responded to */}
          {showHero && (
            <div className="intro-centered">
              <img src={pic} alt="Keerti" className="hero-pic" />

              <h1 className="hero-title">Hi 👋, I'm Keerti</h1>
              <p className="hero-subtitle">Seasoned Product Designer & Developer</p>

              <p className="hero-description">
              I help build B2B SaaS tools that manage people, access, and cloud resources
— enabling organizations to operate efficiently at scale.
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
          <ChatAgent messages={messages} setMessages={setMessages} />

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

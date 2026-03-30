import React, { useState, useEffect } from 'react';
import { User } from '../../services/types';
import HRKPIsDesktop from './HRKPIsDesktop';
import HRKPIsMobile from './HRKPIsMobile';

interface HRKPIsProps {
    user: User;
    selectedProjectId: string;
}

/**
 * HRKPIs - Adaptive KPI Evaluation Screen
 *
 * This component intelligently switches between:
 * - HRKPIsDesktop: Traditional table-based view for web/desktop users (≥1024px)
 * - HRKPIsMobile: Mobile-optimized card-based view for mobile users (<1024px)
 *
 * The layout automatically adapts based on screen size and responds to window resize events.
 */
const HRKPIs: React.FC<HRKPIsProps> = ({ user, selectedProjectId }) => {
    const [isMobileView, setIsMobileView] = useState(false);

    useEffect(() => {
        // Detect initial screen size
        const handleResize = () => {
            setIsMobileView(window.innerWidth < 1024);
        };

        // Set initial state
        handleResize();

        // Add resize listener
        window.addEventListener('resize', handleResize);

        // Cleanup
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // Render appropriate component based on screen size
    if (isMobileView) {
        return <HRKPIsMobile user={user} selectedProjectId={selectedProjectId} />;
    } else {
        return <HRKPIsDesktop user={user} selectedProjectId={selectedProjectId} />;
    }
};

export default HRKPIs;

# KPI Mobile Screen - Implementation Guide

## Quick Start

### 1. Install Dependencies (Already Included)
```bash
npm install react supabase-js tailwindcss
```

### 2. Import Component
```typescript
import HRKPIs from '@/pages/HR/HRKPIs';
```

### 3. Use in Route
```tsx
<Route path="/hr/kpis" element={<HRKPIs user={user} selectedProjectId={projectId} />} />
```

---

## Component Props

```typescript
interface HRKPIsProps {
    user: User;              // Current logged-in user (for role-based access)
    selectedProjectId: string;  // Project to filter KPIs (or 'all')
}
```

### User Object
```typescript
interface User {
    id: string;
    email: string;
    role: 'super_admin' | 'power_admin' | 'hr_admin' | 'employee' | 'project_manager' | 'it_specialist';
    projectId?: string;
}
```

---

## State Management

### Local State Variables
```typescript
const [employees, setEmployees] = useState<Employee[]>([]);
const [kpiData, setKpiData] = useState<KPIEntry[]>([]);
const [projectKpiData, setProjectKpiData] = useState<ProjectKPI[]>([]);
const [loading, setLoading] = useState(true);
const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
const [isSaving, setIsSaving] = useState(false);
const [searchTerm, setSearchTerm] = useState('');
const [expandedEmployee, setExpandedEmployee] = useState<string | null>(null);  // For collapsible rows
const [darkMode, setDarkMode] = useState(false);  // Dark mode toggle
const [viewMode, setViewMode] = useState<'card' | 'table'>('card');  // Mobile vs desktop
const touchStartX = useRef(0);  // For swipe detection
```

---

## Key Functions

### Fetch Data
```typescript
const fetchData = async () => {
    // 1. Get active employees filtered by project
    // 2. Get KPI records for selected date
    // 3. Get project data and project KPI volumes
    // 4. Merge data into local state
};
```

**Triggers on:**
- Component mount
- Date change
- Project selection change

---

### Update Score
```typescript
const handleScoreChange = (
    empId: string,
    field: keyof KPIEntry,
    value: any
) => {
    setKpiData(prev => prev.map(rec =>
        rec.employee_id === empId ? { ...rec, [field]: value } : rec
    ));
};
```

**Called when:**
- User types in score input
- User updates notes

---

### Save to Database
```typescript
const saveKPIs = async () => {
    // 1. Prepare updates array
    // 2. Upsert to hr_kpis (employee KPIs)
    // 3. Upsert to hr_project_kpis (project volumes)
    // 4. Show success/error message
    // 5. Reload data
};
```

**Conflict Resolution:**
- Uses `onConflict: 'employee_id,date'`
- Overwrites existing records
- Preserves historical data

---

### Calculate Average
```typescript
const calculateAverage = (rec: KPIEntry) => {
    return (
        (rec.productivity_score +
         rec.quality_score +
         rec.attendance_score +
         rec.commitment_score) / 4
    ).toFixed(1);
};
```

Returns: `"75.5"` (string with 1 decimal place)

---

## Responsive Behavior

### View Mode Auto-Switch
```typescript
useEffect(() => {
    const handleResize = () => {
        setViewMode(window.innerWidth >= 1024 ? 'table' : 'card');
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
}, []);
```

- **Automatic:** Switches when window resized
- **Manual:** Bottom nav buttons on mobile
- **Smooth:** No page reload

---

## Dark Mode Implementation

### Toggle
```typescript
<button onClick={() => setDarkMode(!darkMode)}>
    <span className="material-icons">
        {darkMode ? 'light_mode' : 'dark_mode'}
    </span>
</button>
```

### Apply to Elements
```typescript
className={`
    ${darkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-800'}
    ${darkMode ? 'border-gray-700' : 'border-gray-200'}
`}
```

### Persistent (Optional Enhancement)
```typescript
// On load
const [darkMode, setDarkMode] = useState(() =>
    localStorage.getItem('darkMode') === 'true'
);

// On change
useEffect(() => {
    localStorage.setItem('darkMode', darkMode.toString());
}, [darkMode]);
```

---

## Touch Gestures

### Swipe Detection
```typescript
const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
};

const handleTouchEnd = (e: React.TouchEvent) => {
    const touchEndX = e.changedTouches[0].clientX;
    const difference = touchStartX.current - touchEndX;

    if (difference > 50) {
        setViewMode('table');  // Swiped left
    } else if (difference < -50) {
        setViewMode('card');   // Swiped right
    }
};
```

**Threshold:** 50px minimum swipe distance

---

## Styling Deep Dive

### Touch Target Size
```css
.touch-target {
    min-height: 44px;
    min-width: 44px;
}
```

Applied to: buttons, inputs, selectable areas

### Color System
```typescript
// Success (Green)
'bg-green-50 dark:bg-green-900'
'border-green-200 dark:border-green-700'
'text-green-700 dark:text-green-300'

// Warning (Yellow)
'bg-yellow-50 dark:bg-yellow-900'
'border-yellow-200 dark:border-yellow-700'
'text-yellow-700 dark:text-yellow-300'

// Danger (Red)
'bg-red-50 dark:bg-red-900'
'border-red-200 dark:border-red-700'
'text-red-700 dark:text-red-300'
```

### Responsive Typography
```typescript
className="text-xs md:text-sm lg:text-base"
// Mobile: 12px
// Tablet: 14px
// Desktop: 16px
```

---

## API Integration

### Supabase Tables

#### `hr_kpis`
```sql
CREATE TABLE hr_kpis (
    employee_id UUID REFERENCES hr_employees(id),
    date DATE,
    productivity_score INTEGER,
    quality_score INTEGER,
    attendance_score INTEGER,
    commitment_score INTEGER,
    notes TEXT,
    PRIMARY KEY (employee_id, date)
);
```

#### `hr_project_kpis`
```sql
CREATE TABLE hr_project_kpis (
    project_id UUID REFERENCES projects(id),
    date DATE,
    volume INTEGER,
    PRIMARY KEY (project_id, date)
);
```

### Queries Used

**Fetch Employees:**
```typescript
supabase
    .from('hr_employees')
    .select('id, full_name, department, employee_code')
    .eq('status', 'active')
    .or(`project.eq.${projectName},project.eq.${projectId}`)
```

**Fetch KPIs:**
```typescript
supabase
    .from('hr_kpis')
    .select('*')
    .eq('date', selectedDate)
    .in('employee_id', empIds)
```

**Upsert KPIs:**
```typescript
supabase
    .from('hr_kpis')
    .upsert(updates, { onConflict: 'employee_id,date' })
```

---

## Error Handling

### Network Errors
```typescript
try {
    // API call
} catch (error) {
    console.error("Error:", error);
    alert('حدث خطأ أثناء الحفظ: ' + error.message);
}
```

### Validation
```typescript
if (!selectedDate) {
    alert('يرجى تحديد التاريخ');
    return;
}

if (kpiData.length === 0) {
    alert('لا توجد بيانات لحفظها');
    return;
}
```

---

## Performance Optimization

### Memoization (Optional)
```typescript
const KPICard = React.memo(({ entry, employee, onScoreChange }) => {
    // Component only re-renders if props change
});
```

### Lazy Loading Images (If Added)
```typescript
<img
    src={url}
    loading="lazy"
    alt="description"
/>
```

### Virtual Scrolling (For Large Lists)
```typescript
import { FixedSizeList } from 'react-window';

<FixedSizeList
    height={600}
    itemCount={kpiData.length}
    itemSize={100}
>
    {({ index, style }) => (
        <div style={style}>
            {/* Card content */}
        </div>
    )}
</FixedSizeList>
```

---

## Testing

### Unit Test Example
```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import HRKPIs from './HRKPIs';

describe('HRKPIs', () => {
    it('should render header', () => {
        render(<HRKPIs user={mockUser} selectedProjectId="123" />);
        expect(screen.getByText('تقييم الأداء')).toBeInTheDocument();
    });

    it('should update score on input change', async () => {
        render(<HRKPIs user={mockUser} selectedProjectId="123" />);
        const input = screen.getByDisplayValue('0');
        fireEvent.change(input, { target: { value: '85' } });
        expect(input.value).toBe('85');
    });

    it('should save data on button click', async () => {
        render(<HRKPIs user={mockUser} selectedProjectId="123" />);
        const saveBtn = screen.getByText('حفظ');
        fireEvent.click(saveBtn);
        // Assert save was called
    });
});
```

---

## Debugging Tips

### React DevTools
1. Install React DevTools extension
2. Open Components tab
3. Inspect HRKPIs component state
4. Watch viewMode, darkMode, loading states

### Supabase Studio
1. Go to Supabase dashboard
2. Open "SQL Editor"
3. Check hr_kpis and hr_project_kpis tables
4. Verify data is being saved

### Network Tab
1. Open DevTools → Network
2. Filter by "Fetch/XHR"
3. Check requests to Supabase
4. Verify response payloads

---

## Common Issues & Solutions

### Issue: Scores not saving
**Solution:**
- Check database connection
- Verify employee_id exists
- Check date format (YYYY-MM-DD)
- Look for constraint violations

### Issue: Mobile layout broken
**Solution:**
- Clear browser cache
- Check Tailwind CSS is bundled
- Verify viewport meta tag exists
- Test in device mode (F12)

### Issue: Dark mode colors wrong
**Solution:**
- Verify `darkMode` state is true
- Check Tailwind config has darkMode enabled
- Use `dark:` prefix for styles
- Test in DevTools

### Issue: Swipe not working
**Solution:**
- Only works on touch devices
- Need 50px+ swipe distance
- Check touchStartX ref is persisted
- Test on actual mobile device

---

## Accessibility Testing

### Keyboard Navigation
- Tab through all inputs
- Enter to submit
- Escape to close modals
- All buttons clickable with keyboard

### Screen Reader
```bash
# Test with NVDA (Windows) or VoiceOver (Mac)
# Navigate by headings, landmarks
# Verify input labels
# Check alt text on icons
```

### Color Contrast
```bash
# Use WCAG Contrast Checker
# Verify 4.5:1 for normal text
# Verify 3:1 for large text (18px+)
# Test in grayscale mode
```

---

## Deployment Checklist

- [ ] All tests passing
- [ ] TypeScript compilation clean
- [ ] Tailwind CSS purge configured
- [ ] Database migrations applied
- [ ] Environment variables set
- [ ] Supabase RLS policies updated
- [ ] Performance profile acceptable
- [ ] Mobile tested on real devices
- [ ] Dark mode tested
- [ ] RTL layout verified
- [ ] Accessibility audit passed
- [ ] Error handling tested

---

## Support

For issues or questions:
1. Check this guide first
2. Review component source code
3. Check Supabase documentation
4. Open GitHub issue
5. Contact development team

---

**Version:** 3.0.0
**Last Updated:** 2026-03-30
**Status:** Production Ready ✅

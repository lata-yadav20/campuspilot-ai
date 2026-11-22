
import { AnnaAppRuntime } from "/static/anna-apps/_sdk/latest/index.js";

const STORAGE_KEY = "campuspilot-ai:data";

const defaultData = {
  goal: "",
  tasks: [],
  activities: [],
  sessions: [],
  totalStudySeconds: 0,
  dailyStudySeconds: 0,
  dailyHistory: [],
  currentDate: ""
};

async function main() {
  const $ = (id) => document.getElementById(id);

  const status = $("status");
  const goalInput = $("goal-input");
  const goalOutput = $("goal-output");
  const taskInput = $("task-input");
  const taskList = $("task-list");
  const scheduleTitle = $("schedule-title");
  const scheduleStart = $("schedule-start");
  const scheduleEnd = $("schedule-end");
  const scheduleList = $("schedule-list");
  const timerDisplay = $("timer-display");
  const timerStatus = $("timer-status");
  const coachOutput = $("coach-output");

  let anna = null;
  let storageReady = false;
  let storageETag = null;
  let saveQueue = Promise.resolve();

  let data = structuredClone(defaultData);


  let timerInterval = null;

  let startTime = null;
  let pausedSeconds = 0;
  let isPaused = false;

  // Connect to Anna and load saved data.
  try {
    anna = await AnnaAppRuntime.connect();
    status.textContent =

    "Anna LLM API: " + typeof anna.llm?.complete;

    await anna.window.set_title({
      title: "CampusPilot AI"
    });
    status.textContent =
    "Connected to Anna. LLM API: " +
    typeof anna.llm?.complete;


    const saved = await anna.storage.get({
      scope: "app",
      key: STORAGE_KEY
    });

    if (saved.exists) {
      data = {
        ...defaultData,
        ...saved.value,

        tasks: Array.isArray(saved.value.tasks)
          ? saved.value.tasks : [],

        activities: Array.isArray(saved.value.activities)
          ? saved.value.activities : [],

        sessions: Array.isArray(saved.value.sessions)
          ? saved.value.sessions : [],

        dailyHistory: Array.isArray(saved.value.dailyHistory)
          ? saved.value.dailyHistory : [],

        currentDate: saved.value.currentDate || ""
      };

      storageETag = saved.etag;
    }







    storageReady = true;
    status.textContent =
    "Connected to Anna. LLM API: " +
    typeof anna.llm?.complete;

  } catch (error) {
    console.error("Anna storage connection failed:", error);
    status.textContent =
      "Storage unavailable. Changes will remain temporary in this session.";
  }

  function getIndiaDate() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());

    const values = {};
    parts.forEach(part => {
      values[part.type] = part.value;
    });

    return `${values.year}-${values.month}-${values.day}`;
  }

  async function checkDayRollover() {
    const today = getIndiaDate();

    if (!data.currentDate) {
      data.currentDate = today;
      await saveData();
      return;
    }

    if (data.currentDate === today) return;

    const totalTasks = data.tasks.length;
    const completedTasks = data.tasks.filter(
      task => task.completed
    ).length;

    const productivity = totalTasks === 0
      ? 0
      : Math.round((completedTasks / totalTasks) * 100);

    data.dailyHistory.push({
      date: data.currentDate,
      completedTasks,
      totalTasks,
      productivity,
      studySeconds: data.dailyStudySeconds || 0
    });

    data.tasks.forEach(task => {
      task.completed = false;
    });

    data.dailyStudySeconds = 0;
    data.currentDate = today;

    await saveData();
    renderTasks();
  }



  // Save data to Anna APS.
  function saveData() {
    if (!storageReady) {
      status.textContent = "Temporary session mode. APS is unavailable.";
      return Promise.resolve(false);
    }

    // Serialize writes so that they do not overwrite each other.
    saveQueue = saveQueue.then(async () => {
      const options = {
        scope: "app",
        key: STORAGE_KEY,
        value: data
      };

      if (storageETag) {
        options.if_match = storageETag;
      }

      await anna.storage.set(options);

      // Read again to obtain the latest ETag.
      const latest = await anna.storage.get({
        scope: "app",
        key: STORAGE_KEY
      });

      if (!latest.exists) {
        throw new Error("Saved data could not be verified.");
      }

      storageETag = latest.etag;
      status.textContent = "Your data is saved permanently in Anna.";

      return true;
    }).catch((error) => {
      console.error("APS save failed:", error);
      status.textContent =
        "Storage save failed. Please check the connection before refreshing.";
      return false;
    });

    return saveQueue;
  }

  // Render goal.
  function renderGoal() {
    goalOutput.textContent = data.goal
      ? "Your goal: " + data.goal
      : "No goal added yet.";

    goalInput.value = data.goal;
  }

  $("save-goal").addEventListener("click", async () => {
    const goal = goalInput.value.trim();

    if (!goal) {
      goalOutput.textContent = "Please enter a goal first.";
      return;
    }

    data.goal = goal;
    renderGoal();
    await saveData();
  });

  // Render tasks.

  function renderTasks() {
      taskList.replaceChildren();

      const totalTasks = data.tasks.length;
      const completedTasks = data.tasks.filter(
        task => task.completed
      ).length;

      const percentage = totalTasks === 0
        ? 0
        : Math.round((completedTasks / totalTasks) * 100);

      $("task-progress-text").textContent =
        `${completedTasks} / ${totalTasks} completed`;

      $("task-progress-bar").style.width = percentage + "%";

      data.tasks.forEach((task, index) => {

      const row = document.createElement("div");
      row.className = "task";

      const info = document.createElement("div");
      info.className = "task-info";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = task.completed;

      const label = document.createElement("span");
      label.textContent = task.title;

      if (task.completed) {
        label.classList.add("completed");
      }

      checkbox.addEventListener("change", async () => {
        task.completed = checkbox.checked;
        renderTasks();
        await saveData();
      });

      info.append(checkbox, label);

      const deleteButton = document.createElement("button");
      deleteButton.textContent = "Delete";
      deleteButton.className = "danger";

      deleteButton.addEventListener("click", async () => {
        data.tasks.splice(index, 1);
        renderTasks();
        await saveData();
      });

      row.append(info, deleteButton);
      taskList.appendChild(row);
    });
    renderAnalytics();
  }

  function renderWeeklyReport() {
    const container = $("weekly-report");
    container.replaceChildren();

    const today = getIndiaDate();
    const todayDate = new Date(today + "T00:00:00Z");

    const records = new Map();

    (data.dailyHistory || []).forEach(record => {
      records.set(record.date, record);
    });

    const completedToday = data.tasks.filter(
      task => task.completed
    ).length;

    records.set(today, {
      date: today,
      studySeconds: data.dailyStudySeconds || 0,
      completedTasks: completedToday,
      totalTasks: data.tasks.length,
      productivity: data.tasks.length
        ? Math.round(completedToday / data.tasks.length * 100)
        : 0
    });

    const weekRecords = [];

    for (let i = 0; i < 7; i++) {
      const date = new Date(todayDate);
      date.setUTCDate(date.getUTCDate() - i);

      const dateKey = date.toISOString().slice(0, 10);

      if (records.has(dateKey)) {
        weekRecords.push(records.get(dateKey));
      }
    }

    const totalSeconds = weekRecords.reduce(
      (sum, record) => sum + (record.studySeconds || 0),
      0
    );

    const completedTasks = weekRecords.reduce(
      (sum, record) => sum + (record.completedTasks || 0),
      0
    );

    const activeDays = weekRecords.filter(
      record =>
        (record.studySeconds || 0) > 0 ||
        (record.completedTasks || 0) > 0
    ).length;

    const productivityRecords = weekRecords.filter(
      record => (record.totalTasks || 0) > 0
    );

    const averageProductivity = productivityRecords.length
      ? Math.round(
          productivityRecords.reduce(
            (sum, record) => sum + (record.productivity || 0),
            0
          ) / productivityRecords.length
        )
      : 0;

    const items = [
      `Study time: ${(totalSeconds / 3600).toFixed(2)} hours`,
      `Active study days: ${activeDays} / 7`,
      `Completed tasks: ${completedTasks}`,
      `Average productivity: ${
        productivityRecords.length
          ? averageProductivity + "%"
          : "Not enough data"
      }`,
      `Days with saved records: ${weekRecords.length}`
    ];

    items.forEach(value => {
      const item = document.createElement("p");
      item.textContent = "• " + value;
      container.appendChild(item);
    });
  }


// Render dashboard overview cards.
  function renderOverview() {
    // Today's study time, including a running timer.
    const currentSeconds = startTime
      ? Math.floor((Date.now() - startTime) / 1000)
      : 0;

    const todaySeconds =
      (data.dailyStudySeconds || 0) +
      pausedSeconds +
      currentSeconds;
    // Daily study goal: 8 hours.
    const dailyGoalSeconds = 8 * 60 * 60;

    const goalProgress = Math.min(
      (todaySeconds / dailyGoalSeconds) * 100,
      100
    );
    const goalTimeDisplay = todaySeconds < 60
      ? `${Math.floor(todaySeconds)}s`
      : todaySeconds < 3600
        ? `${(todaySeconds / 60).toFixed(1)} min`
        : `${(todaySeconds / 3600).toFixed(2)} hours`;

    $("daily-goal-time").textContent =
      `${goalTimeDisplay} / 8 hours`;

    $("daily-goal-progress").style.width =
      `${goalProgress}%`;

    $("daily-goal-message").textContent =
      goalProgress >= 100
        ? "Daily study goal completed! 🎉"
        :`${goalProgress.toFixed(1)}% completed. Keep going!`;


    const hours = Math.floor(todaySeconds / 3600);
    const minutes = Math.floor((todaySeconds % 3600) / 60);
    const seconds = todaySeconds % 60;

    $("overview-study-time").textContent =
      hours > 0
        ? `${hours}h ${minutes}m`
        : minutes > 0
          ? `${minutes}m ${seconds}s`
          : `${seconds}s`;

    // Today's completed tasks.
    const totalTasks = data.tasks.length;
    const completedTasks = data.tasks.filter(
      task => task.completed
    ).length;

    $("overview-tasks").textContent =
      `${completedTasks} / ${totalTasks}`;

    // Today's productivity.
    const productivity = totalTasks
      ? Math.round((completedTasks / totalTasks) * 100)
      : 0;

    $("overview-productivity").textContent =
      `${productivity}%`;

    // Active days during the last seven days.
    const today = getIndiaDate();
    const todayDate = new Date(today + "T00:00:00Z");
    const records = new Map();

    (data.dailyHistory || []).forEach(record => {
      records.set(record.date, record);
    });

    records.set(today, {
      studySeconds: todaySeconds,
      completedTasks,
      totalTasks
    });

    let activeDays = 0;

    for (let i = 0; i < 7; i++) {
      const date = new Date(todayDate);
      date.setUTCDate(date.getUTCDate() - i);

      const dateKey = date.toISOString().slice(0, 10);
      const record = records.get(dateKey);

      if (
        record &&
        ((Number(record.studySeconds) || 0) > 0 ||
        (Number(record.completedTasks) || 0) > 0)
      ) {
        activeDays++;
      }
    }

    $("overview-active-days").textContent =
      `${activeDays} / 7`;
        // Study streak calculations.
      const isStudyDay = record =>
        record &&
        (
          (Number(record.studySeconds) || 0) > 0 ||
          (Number(record.completedTasks) || 0) > 0
        );

      const studyDates = new Set();

      (data.dailyHistory || []).forEach(record => {
        if (isStudyDay(record)) {
          studyDates.add(record.date);
        }
      });

      // Include today's live activity.
      if (isStudyDay({
        studySeconds: todaySeconds,
        completedTasks
      })) {
        studyDates.add(today);
      }

      // Calculate current streak.
      let currentStreak = 0;
      let streakDate = new Date(todayDate);

      // If today is not active yet, allow yesterday's streak to continue.
      if (!studyDates.has(today)) {
        streakDate.setUTCDate(streakDate.getUTCDate() - 1);
      }

      while (studyDates.has(streakDate.toISOString().slice(0, 10))) {
        currentStreak++;
        streakDate.setUTCDate(streakDate.getUTCDate() - 1);
      }

      // Calculate longest streak in recorded history.
      const sortedDates = [...studyDates].sort();
      let longestStreak = 0;
      let runningStreak = 0;
      let previousDate = null;

      sortedDates.forEach(dateKey => {
        const date = new Date(dateKey + "T00:00:00Z");

        if (previousDate) {
          const difference =
            (date - previousDate) / (1000 * 60 * 60 * 24);

          runningStreak =
            difference === 1 ? runningStreak + 1 : 1;
        } else {
          runningStreak = 1;
        }

        longestStreak = Math.max(longestStreak, runningStreak);
        previousDate = date;
      });

      $("current-streak").textContent =
        `${currentStreak} days`;

      $("longest-streak").textContent =
        `${longestStreak} days`;
        // Make the actual streak available to AI insights.
      data.currentStreak = currentStreak;
        // Update achievement cards.
       renderAchievements(currentStreak, completedTasks);
        // Study streak milestones.
        const milestones = [
          { days: 3, name: "Consistency Starter 🥉" },
          { days: 7, name: "Weekly Champion 🥈" },
          { days: 14, name: "Focus Master 🥇" },
          { days: 30, name: "Discipline Legend 🏆" }
        ];

        const nextMilestone = milestones.find(
          milestone => currentStreak < milestone.days
        );

        const milestoneMessage =
          document.getElementById("streak-milestone-message");

        const milestoneProgress =
          document.getElementById("streak-milestone-progress");

        if (nextMilestone) {
          milestoneMessage.textContent =
            `Your current achievement: ${currentStreak} study days.`;

          milestoneProgress.textContent =
            `${nextMilestone.days - currentStreak} more day(s) to unlock ${nextMilestone.name}`;
        } else {
          milestoneMessage.textContent =
            "Amazing! You've unlocked every study streak milestone! 🏆";

          milestoneProgress.textContent =
            "Keep building your consistency!";
        }

      // Render the last seven days.
      const streakCalendar =
        document.getElementById("streak-calendar");

      if (streakCalendar) {
        let calendarHTML = "";

        for (let i = 6; i >= 0; i--) {
          const date = new Date(todayDate);
          date.setUTCDate(date.getUTCDate() - i);

          const dateKey = date.toISOString().slice(0, 10);
          const dayName = date.toLocaleDateString("en-IN", {
            weekday: "short",
            timeZone: "UTC"
          });

          const dayNumber = date.getUTCDate();
          const active = studyDates.has(dateKey);

          calendarHTML += `
            <div class="streak-day ${active ? "active" : ""}">
              <span>${dayName}</span>
              <strong>${active ? "✓" : dayNumber}</strong>
            </div>
          `;
        }

        streakCalendar.innerHTML = calendarHTML;
      }

    // Automatically refresh smart study suggestions.
    const suggestionElement =
      document.getElementById("smart-suggestion-output");

    if (suggestionElement) {
      if (totalTasks === 0) {
        suggestionElement.textContent =
          "Add a study task to receive your personalized suggestions.";
      } else if (completedTasks === totalTasks) {
        suggestionElement.textContent =
          "All your current tasks are completed! Plan your next learning activity.";
      } else {
        const nextTask = data.tasks.find(task => !task.completed);

        const remainingMinutes = Math.ceil(
          Math.max(0, (8 * 60 * 60 - todaySeconds) / 60)
        );

        suggestionElement.textContent =
          `Next task: "${nextTask.title}". ` +
          `${completedTasks}/${totalTasks} tasks completed. ` +
          `${goalProgress.toFixed(1)}% of your daily study goal completed. ` +
          `${remainingMinutes} minutes remain to reach 8 hours.`;
      }
    }
  }
  // ===== ACHIEVEMENT SYSTEM =====
  function renderAchievements(currentStreak, completedTasks) {
    const achievements = [
      {
        id: "first-task",
        icon: "🌱",
        name: "First Step",
        description: "Complete your first study task.",
        unlocked: completedTasks >= 1
      },
      {
        id: "three-day",
        icon: "🔥",
        name: "3-Day Streak",
        description: "Study for 3 consecutive days.",
        unlocked: currentStreak >= 3
      },
      {
        id: "seven-day",
        icon: "⭐",
        name: "Weekly Champion",
        description: "Study for 7 consecutive days.",
        unlocked: currentStreak >= 7
      },
      {
        id: "four-focus",
        icon: "🍅",
        name: "Focus Champion",
        description: "Complete 4 Pomodoro focus sessions.",
        unlocked: (Number(data.pomodoroCompleted) || 0) >= 4
      }
    ];

    const container =
      document.getElementById("achievement-list");

    if (!container) return;

    container.innerHTML = achievements.map(item => `
      <div class="achievement-item ${item.unlocked ? "unlocked" : ""}">
        <div class="achievement-icon">${item.icon}</div>
        <h4>${item.name}</h4>
        <p>${item.description}</p>
        <span class="achievement-status">
          ${item.unlocked ? "✓ UNLOCKED" : "🔒 LOCKED"}
        </span>
      </div>
    `).join("");

    const unlockedCount =
      achievements.filter(item => item.unlocked).length;

    document.getElementById("achievement-summary").textContent =
      `${unlockedCount} of ${achievements.length} achievements unlocked`;
  }




  // Render monthly analytics.
  function renderAnalytics() {



    const history = [...(data.dailyHistory || [])];

    const totalTasks = data.tasks.length;
    const completedTasks = data.tasks.filter(
      task => task.completed
    ).length;

    const todayProductivity = totalTasks === 0
      ? 0
      : Math.round((completedTasks / totalTasks) * 100);

    if (data.currentDate) {
      history.push({
        date: data.currentDate,
        studySeconds: data.dailyStudySeconds || 0,
        completedTasks,
        totalTasks,
        productivity: todayProductivity
      });
    }

    const currentMonth = getIndiaDate().slice(0, 7);

    const records = history
      .filter(record => record.date.startsWith(currentMonth))
      .sort((a, b) => a.date.localeCompare(b.date));


    function drawChart(elementId, getValue, suffix, maxValue) {
      const container = document.getElementById(elementId);
      container.replaceChildren();

      if (records.length === 0) {
        container.textContent = "Your daily progress will appear here.";
        return;
      }

      records.forEach(record => {
        const value = Number(getValue(record)) || 0;

        const row = document.createElement("div");
        row.style.margin = "12px 0";

        const label = document.createElement("div");
        const displayValue = elementId === "study-chart"
          ? value < 1
            ? `${(value * 60).toFixed(1)} minutes`
            : `${value.toFixed(1)} hours`
          : `${value}${suffix}`;

        label.textContent = `${record.date}: ${displayValue}`;
        label.style.fontSize = "12px";
        label.style.color = "#aab5cc";
        label.style.marginBottom = "5px";

        const track = document.createElement("div");
        track.style.height = "9px";
        track.style.background = "#293653";
        track.style.borderRadius = "20px";
        track.style.overflow = "hidden";

        const bar = document.createElement("div");
        bar.style.height = "100%";
        bar.style.width =
          Math.min(100, (value / Math.max(1, maxValue)) * 100) + "%";
        bar.style.background = "linear-gradient(90deg, #7965ed, #3989e8)";
        bar.style.borderRadius = "20px";

        track.appendChild(bar);
        row.append(label, track);
        container.appendChild(row);
      });
    }

    const maxStudy = Math.max(
      1,
      ...records.map(record => (record.studySeconds || 0) / 3600)
    );

    const maxTasks = Math.max(
      1,
      ...records.map(record => record.completedTasks || 0)
    );
    drawChart(
      "study-chart",
      record => (Number(record.studySeconds) || 0) / 3600,
      "",
      maxStudy
    );


    drawChart(
      "tasks-chart",
      record => record.completedTasks || 0,
      " tasks",
      maxTasks
    );

    drawChart(
      "productivity-chart",
      record => record.productivity || 0,
      "%",
      100
    );
    // Render weekly study hours.
    const weeklyContainer = document.getElementById("weekly-study-chart");
    weeklyContainer.replaceChildren();

    const today = getIndiaDate();
    const todayDate = new Date(today + "T00:00:00Z");

    const weeklyRecords = [];

    for (let i = 6; i >= 0; i--) {
      const date = new Date(todayDate);
      date.setUTCDate(date.getUTCDate() - i);

      const dateKey = date.toISOString().slice(0, 10);

      const record = history.find(item => item.date === dateKey);

      weeklyRecords.push({
        date: dateKey,
        studyHours: record
          ? (Number(record.studySeconds) || 0) / 3600
          : 0
      });
    }

    const maxWeeklyStudy = Math.max(
      1,
      ...weeklyRecords.map(record => record.studyHours)
    );

    weeklyRecords.forEach(record => {
      const row = document.createElement("div");
      row.style.margin = "14px 0";

      const label = document.createElement("div");
      label.textContent =
        `${record.date}: ${record.studyHours.toFixed(2)} hours`;
      label.style.color = "#aab5cc";
      label.style.fontSize = "12px";
      label.style.marginBottom = "6px";

      const track = document.createElement("div");
      track.style.height = "12px";
      track.style.background = "#293653";
      track.style.borderRadius = "20px";
      track.style.overflow = "hidden";

      const bar = document.createElement("div");
      bar.style.height = "100%";
      bar.style.width =
        `${(record.studyHours / maxWeeklyStudy) * 100}%`;
      bar.style.background =
        "linear-gradient(90deg, #7965ed, #43d9bd)";
      bar.style.borderRadius = "20px";
      bar.style.transition = "width 0.5s ease";

      track.appendChild(bar);
      row.append(label, track);
      weeklyContainer.appendChild(row);
    });
  }
    renderWeeklyReport();


  $("add-task").addEventListener("click", async () => {
    const title = taskInput.value.trim();

    if (!title) {
      status.textContent = "Please enter a task.";
      return;
    }

    data.tasks.push({
      title,
      completed: false
    });

    taskInput.value = "";
    renderTasks();
    await saveData();
  });

  // Render the daily schedule.
  function renderSchedule() {
    scheduleList.replaceChildren();

    data.activities.forEach((activity, index) => {
      const row = document.createElement("div");
      row.className = "activity";

      const details = document.createElement("div");
      details.className = "activity-details";

      const title = document.createElement("strong");
      title.textContent = activity.title;

      const time = document.createElement("span");
      time.className = "time-label";
      time.textContent = `${activity.start} – ${activity.end}`;

      details.append(title, time);

      const editButton = document.createElement("button");
      editButton.textContent = "Edit";
      editButton.className = "secondary";

      editButton.addEventListener("click", async () => {
        const newTitle = prompt("Activity name:", activity.title);
        if (newTitle === null) return;

        const newStart = prompt("Start time (HH:MM):", activity.start);
        if (newStart === null) return;

        const newEnd = prompt("End time (HH:MM):", activity.end);
        if (newEnd === null) return;

        const title = newTitle.trim();

        if (
          !title ||
          !/^([01]\d|2[0-3]):[0-5]\d$/.test(newStart) ||
          !/^([01]\d|2[0-3]):[0-5]\d$/.test(newEnd) ||
          newStart >= newEnd
        ) {
          alert("Please enter valid activity details.");
          return;
        }

        const overlap = data.activities.some((other, i) =>
          i !== index &&
          newStart < other.end &&
          newEnd > other.start
        );

        if (overlap) {
          alert("This activity overlaps with another activity.");
          return;
        }

        activity.title = title;
        activity.start = newStart;
        activity.end = newEnd;

        data.activities.sort((a, b) =>
          a.start.localeCompare(b.start)
        );

        renderSchedule();
        await saveData();
      });

      const deleteButton = document.createElement("button");
      deleteButton.textContent = "Delete";
      deleteButton.className = "danger";

      deleteButton.addEventListener("click", async () => {
        data.activities.splice(index, 1);
        renderSchedule();
        await saveData();
      });

      row.append(details, editButton, deleteButton);
      scheduleList.appendChild(row);
    });
  }

  $("add-schedule").addEventListener("click", async () => {
    const title = scheduleTitle.value.trim();
    const start = scheduleStart.value;
    const end = scheduleEnd.value;

    if (!title || !start || !end) {
      status.textContent = "Please complete all schedule fields.";
      return;
    }

    if (start >= end) {
      status.textContent = "End time must be later than start time.";
      return;
    }

    const overlap = data.activities.some(activity =>
      start < activity.end && end > activity.start
    );

    if (overlap) {
      status.textContent = "This activity overlaps with another activity.";
      return;
    }

    data.activities.push({ title, start, end });

    data.activities.sort((a, b) =>
      a.start.localeCompare(b.start)
    );

    scheduleTitle.value = "";
    scheduleStart.value = "";
    scheduleEnd.value = "";

    renderSchedule();
    await saveData();
  });

  // Study timer.
  function formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remaining = seconds % 60;

    return [
      hours,
      minutes,
      remaining
    ].map(value => String(value).padStart(2, "0")).join(":");
  }
  function renderSessionHistory() {
    const container = $("session-history");
    container.replaceChildren();

    const sessions = data.sessions || [];

    if (sessions.length === 0) {
      container.textContent = "No study sessions recorded yet.";
      return;
    }

    sessions.slice(-10).reverse().forEach(session => {
      const item = document.createElement("div");
      item.className = "activity";

      const details = document.createElement("div");
      details.className = "activity-details";

      details.textContent =
        `${session.date} — ${session.label || "Study Session"} — ${formatTime(session.durationSeconds)}`;


      item.appendChild(details);
      container.appendChild(item);
    });
  }

  function updateTimer() {
    const currentSeconds = startTime
      ? Math.floor((Date.now() - startTime) / 1000)
      : 0;

    timerDisplay.textContent = formatTime(
      data.totalStudySeconds + pausedSeconds + currentSeconds
    );
    renderOverview();
  }

  // Start or resume session.
  $("timer-start").addEventListener("click", () => {
    if (timerInterval) return;

    startTime = Date.now();
    isPaused = false;

    timerStatus.textContent = "Study session running.";
    updateTimer();

    timerInterval = setInterval(updateTimer, 1000);
  });

  // Pause session.
  $("timer-pause").addEventListener("click", () => {
    if (!timerInterval) {
      timerStatus.textContent = "No active session to pause.";
      return;
    }

    pausedSeconds += Math.floor(
      (Date.now() - startTime) / 1000
    );

    clearInterval(timerInterval);
    timerInterval = null;
    startTime = null;
    isPaused = true;

    updateTimer();
    timerStatus.textContent = "Session paused. Press Start to resume.";
  });

  // Finish session.
  $("timer-stop").addEventListener("click", async () => {
    if (!timerInterval && !isPaused) {
      timerStatus.textContent = "Start the timer first.";
      return;
    }

    let elapsed = pausedSeconds;

    if (timerInterval && startTime) {
      elapsed += Math.floor(
        (Date.now() - startTime) / 1000
      );
    }

    clearInterval(timerInterval);
    timerInterval = null;
    startTime = null;
    isPaused = false;
    pausedSeconds = 0;

    data.sessions.push({
      date: getIndiaDate(),
      label: $("session-label").value.trim() || "Study Session",
      durationSeconds: elapsed
    });


    renderSessionHistory();

    data.totalStudySeconds += elapsed;
    data.dailyStudySeconds =
      (data.dailyStudySeconds || 0) + elapsed;

    timerDisplay.textContent =
      formatTime(data.totalStudySeconds);

    renderAnalytics();

    timerStatus.textContent =
      `Session recorded: ${Math.floor(elapsed / 60)} minutes.`;

    await saveData();
  });




  // Progress review.

function renderCoachMarkdown(markdown) {
  coachOutput.replaceChildren();

  const lines = markdown.split("\n");
  let currentList = null;

  function addInlineText(element, text) {
    const parts = text.split(/(\*\*.*?\*\*)/g);

    parts.forEach(part => {
      if (part.startsWith("**") && part.endsWith("**")) {
        const strong = document.createElement("strong");
        strong.textContent = part.slice(2, -2);
        element.appendChild(strong);
      } else {
        element.appendChild(document.createTextNode(part));
      }
    });
  }

  lines.forEach(line => {
    const trimmed = line.trim();

    if (!trimmed) {
      currentList = null;
      return;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      if (!currentList) {
        currentList = document.createElement("ul");
        coachOutput.appendChild(currentList);
      }

      const item = document.createElement("li");
      addInlineText(item, trimmed.replace(/^[-*]\s+/, ""));
      currentList.appendChild(item);
      return;
    }

    currentList = null;

    if (trimmed.startsWith("### ")) {
      const heading = document.createElement("h4");
      addInlineText(heading, trimmed.slice(4));
      coachOutput.appendChild(heading);
    } else if (trimmed.startsWith("## ")) {
      const heading = document.createElement("h3");
      addInlineText(heading, trimmed.slice(3));
      coachOutput.appendChild(heading);
    } else {
      const paragraph = document.createElement("p");
      addInlineText(paragraph, trimmed);
      coachOutput.appendChild(paragraph);
    }
  });
}



$("coach-button").addEventListener("click", async () => {
  coachOutput.textContent =
    "CampusPilot AI is analysing your study data...";

  try {
    // Analyse recorded study sessions.
    const sessions = data.sessions || [];

    const totalSessionSeconds = sessions.reduce(
      (sum, session) => sum + (session.durationSeconds || 0),
      0
    );
    const totalRecordedSeconds = data.totalStudySeconds || 0;

    // Calculate time spent on each subject.
    const subjectTotals = {};

    sessions.forEach(session => {
      const subject = session.label || "Study Session";

      subjectTotals[subject] =
        (subjectTotals[subject] || 0) +
        (session.durationSeconds || 0);
    });

    const subjectInsights = Object.entries(subjectTotals)
      .map(([subject, seconds]) => ({
        subject,
        studySeconds: seconds,
        studyMinutes: Number((seconds / 60).toFixed(2))
      }))
      .sort((a, b) => b.studyMinutes - a.studyMinutes);

    // Count days with recorded study sessions.
    const studyDays = [
      ...new Set(sessions.map(session => session.date))
    ];

    // Get the latest daily records.
    const recentHistory = (data.dailyHistory || []).slice(-7);

    const completedTasks = data.tasks.filter(
      task => task.completed
    );

    const pendingTasks = data.tasks.filter(
      task => !task.completed
    );
    // Generate personalized study suggestions.
    const todayMinutes =
      (data.dailyStudySeconds || 0) / 60;

    const dailyGoalMinutes = 8 * 60;

    const goalPercentage = Math.min(
      100,
      Math.round((todayMinutes / dailyGoalMinutes) * 100)
    );

    const suggestionElement =
      document.getElementById("smart-suggestion-output");

    let smartSuggestion = "";

    if (pendingTasks.length > 0) {
      smartSuggestion =
        `You have ${pendingTasks.length} pending task(s). ` +
        `Consider starting with: "${pendingTasks[0].title}".`;
    } else {
      smartSuggestion =
        "All your current tasks are completed. Great work! " +
        "You can plan your next learning activity.";
    }

    if (goalPercentage >= 100) {
      smartSuggestion +=
        " Your 8-hour study goal is complete. Remember to take breaks.";
    } else {
      const remainingMinutes = Math.ceil(
        dailyGoalMinutes - todayMinutes
      );

      smartSuggestion +=
        ` Your daily study goal is ${goalPercentage}% complete. ` +
        `${remainingMinutes} minutes remain to reach your target.`;
    }

    suggestionElement.textContent = smartSuggestion;

    const prompt = `
You are CampusPilot AI, a supportive and accountable student productivity coach.

Analyse only the student's actual recorded data.

STUDENT GOAL:
${data.goal || "Not set"}

RECORDED STUDY DATA:
Total recorded timer time: ${Math.floor(totalRecordedSeconds / 60)} minutes.
Time in saved session history: ${Math.floor(totalSessionSeconds / 60)} minutes.
IMPORTANT DATA DEFINITIONS:
- Total recorded timer time is the cumulative timer total.
- Saved session history contains only individually recorded sessions.
- These two values may differ because older timer time may exist without individual session records.
- Never describe this difference as lost or missing study time.
- Analyse subject-wise study time only from saved session history.
- Completed tasks are separate from timer records.
- Never assume completed tasks were not genuinely done just because timer time is short.
- Do not judge the user's effort or progress negatively based only on short recorded durations.
- Give constructive, supportive suggestions based strictly on the available data.

Total completed sessions: ${sessions.length}
Days with recorded study sessions: ${studyDays.length}

SUBJECT-WISE STUDY TIME:
${JSON.stringify(subjectInsights)}

RECENT DAILY HISTORY:
${JSON.stringify(recentHistory)}

CURRENT TASKS:
Completed tasks: ${JSON.stringify(completedTasks)}
Pending tasks: ${JSON.stringify(pendingTasks)}

DAILY STUDY TIME:
${Math.round((data.dailyStudySeconds || 0) / 60)} minutes.

Provide these insights:

1. Overall study progress.
2. Subject-wise study analysis.
3. Study consistency based on recorded session dates.
4. Task completion review.
5. Three practical suggestions for improvement.
6. One realistic next action.

IMPORTANT RULES:
- Use only the supplied recorded information.
- Never invent study hours, completed tasks or achievements.
- If there is insufficient data, clearly say so.
- Do not assume that unrecorded time was wasted.
- Be supportive, honest and specific.
- Never shame the student.

Format the response with clear headings and bullet points.
`;

    const reply = await anna.llm.complete({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: prompt
          }
        }
      ],
      maxTokens: 900
    });

    let answer = "";

    if (typeof reply.content === "string") {
      answer = reply.content;
    } else if (
      reply.content &&
      typeof reply.content === "object" &&
      reply.content.type === "text"
    ) {
      answer = reply.content.text || "";
    } else if (Array.isArray(reply.content)) {
      answer = reply.content
        .filter(item => item.type === "text")
        .map(item => item.text)
        .join("\n");
    }

    if (!answer) {
      answer = "Sorry, I couldn't read the AI response.";
    }

    renderCoachMarkdown(answer);

  } catch (error) {
    console.error("Focus Coach AI error:", error);

    coachOutput.textContent =
      "AI could not respond. Please try again. Error: " +
      (error.message || String(error));
  }
});
// ===== AI CHAT STUDY ASSISTANT =====

let aiChatHistory = [];

const chatInput = document.getElementById("ai-chat-input");
const chatSendButton = document.getElementById("ai-chat-send");
const chatMessages = document.getElementById("ai-chat-messages");

function addChatMessage(message, sender) {
  const messageElement = document.createElement("div");

  messageElement.className =
    `ai-chat-message ${sender}`;

  messageElement.textContent = message;

  chatMessages.appendChild(messageElement);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function sendAIChatMessage() {
  const question = chatInput.value.trim();

  if (!question || chatSendButton.disabled) return;

  chatInput.value = "";

  addChatMessage(question, "user");

  aiChatHistory.push({
    role: "user",
    text: question
  });

  chatSendButton.disabled = true;
  chatSendButton.textContent = "Thinking...";

  try {
    const messages = [
      {
        role: "user",
        content: {
          type: "text",
          text: `You are CampusPilot AI, a friendly and supportive study assistant.

Help students understand programming, Python, C++, DSA, AI, and other academic topics.

Explain concepts clearly with beginner-friendly examples.
When sharing code, explain important parts.
Be accurate, encouraging, and concise.
If a question is unrelated to studying, politely guide the conversation back to learning.

Conversation:`
        }
      },
      ...aiChatHistory.slice(-12).map(message => ({
        role: message.role,
        content: {
          type: "text",
          text: message.text
        }
      }))
    ];

    const reply = await anna.llm.complete({
      messages,
      maxTokens: 900
    });

    let answer = "";

    if (typeof reply.content === "string") {
      answer = reply.content;
    } else if (
      reply.content &&
      typeof reply.content === "object" &&
      reply.content.type === "text"
    ) {
      answer = reply.content.text || "";
    } else if (Array.isArray(reply.content)) {
      answer = reply.content
        .filter(item => item.type === "text")
        .map(item => item.text)
        .join("\n");
    }

    answer = answer.trim() ||
      "Sorry, I couldn't read the AI response.";

    aiChatHistory.push({
      role: "assistant",
      text: answer
    });

    addChatMessage(answer, "assistant");

  } catch (error) {
    console.error("AI Chat error:", error);

    addChatMessage(
      "Sorry, I couldn't respond. Please try again.",
      "assistant"
    );

  } finally {
    chatSendButton.disabled = false;
    chatSendButton.textContent = "Send";
    chatInput.focus();
  }
}

chatSendButton.addEventListener(
  "click",
  sendAIChatMessage
);

chatInput.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    sendAIChatMessage();
  }
});

// ===== AI STUDY PLANNER =====

let generatedAIActivities = [];

document.getElementById("generate-ai-plan")
  .addEventListener("click", async () => {
    const goal = document.getElementById("ai-study-goal").value.trim();
    const hours = Number(
      document.getElementById("ai-study-hours").value
    );

    const output = document.getElementById("ai-plan-output");
    const button = document.getElementById("generate-ai-plan");
    const addButton = document.getElementById("add-ai-plan");

    addButton.style.display = "none";
    generatedAIActivities = [];

    if (!goal || !hours || hours < 1 || hours > 12) {
      output.textContent =
        "Please enter your study goal and available hours (1–12).";
      return;
    }

    button.disabled = true;
    button.textContent = "Generating your plan...";
    output.textContent = "Your AI study plan is being prepared...";

    const pendingTasks = data.tasks
      .filter(task => !task.completed)
      .map(task => task.title);

    const prompt = `
Create a realistic daily study plan.

Goal: ${goal}
Available study time: ${hours} hours.

Pending tasks:
${pendingTasks.length ? pendingTasks.join(", ") : "No pending tasks"}

Return ONLY valid JSON in this exact format:
{
  "activities": [
    {
      "title": "Python Practice",
      "start": "09:00",
      "end": "10:00"
    },
    {
      "title": "Short Break",
      "start": "10:00",
      "end": "10:10"
    }
  ],
  "message": "A short motivational message"
}

Rules:
- Use 24-hour HH:MM time format.
- Include study sessions and short breaks.
- Keep all activities within a continuous ${hours}-hour schedule.
- Do not create overlapping activities.
- Keep each activity title short.
- Include a motivational message.
`;

    try {
      const reply = await anna.llm.complete({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: prompt
            }
          }
        ],
        maxTokens: 900
      });

      let answer = "";

      if (typeof reply.content === "string") {
        answer = reply.content;
      } else if (
        reply.content &&
        typeof reply.content === "object" &&
        reply.content.type === "text"
      ) {
        answer = reply.content.text || "";
      } else if (Array.isArray(reply.content)) {
        answer = reply.content
          .filter(item => item.type === "text")
          .map(item => item.text)
          .join("\n");
      }

      const cleanedAnswer = answer
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();

      const plan = JSON.parse(cleanedAnswer);

      if (!Array.isArray(plan.activities)) {
        throw new Error("Invalid activity list.");
      }

      const validTime = time =>
        typeof time === "string" &&
        /^([01]\d|2[0-3]):[0-5]\d$/.test(time);

      const validActivities = plan.activities.every(activity =>
        activity &&
        typeof activity.title === "string" &&
        activity.title.trim() &&
        validTime(activity.start) &&
        validTime(activity.end) &&
        activity.start < activity.end
      );

      if (!validActivities) {
        throw new Error("The AI returned invalid schedule times.");
      }

      const sortedActivities = [...plan.activities].sort(
        (a, b) => a.start.localeCompare(b.start)
      );

      for (let i = 1; i < sortedActivities.length; i++) {
        if (
          sortedActivities[i].start <
          sortedActivities[i - 1].end
        ) {
          throw new Error("The AI returned overlapping activities.");
        }
      }

      generatedAIActivities = sortedActivities.map(activity => ({
        title: activity.title.trim(),
        start: activity.start,
        end: activity.end
      }));

      output.textContent =
        generatedAIActivities.map(activity =>
          `${activity.start} - ${activity.end} | ${activity.title}`
        ).join("\n") +
        "\n\n" + (plan.message || "Your study plan is ready!");

      addButton.style.display = "block";

    } catch (error) {
      console.error("AI Study Planner error:", error);
      output.textContent =
        "Could not create a valid timetable. Please generate your plan again.";
    } finally {
      button.disabled = false;
      button.textContent = "✨ Generate Study Plan";
    }
  });

// Add generated activities to the existing Daily Planner.
document.getElementById("add-ai-plan")
  .addEventListener("click", async () => {
    if (!generatedAIActivities.length) return;

    const conflicts = generatedAIActivities.some(newActivity =>
      data.activities.some(existing =>
        newActivity.start < existing.end &&
        newActivity.end > existing.start
      )
    );

    if (conflicts) {
      status.textContent =
        "Some AI activities overlap with your existing schedule. Remove conflicting activities first.";
      return;
    }

    data.activities.push(...generatedAIActivities);

    data.activities.sort((a, b) =>
      a.start.localeCompare(b.start)
    );

    renderSchedule();
    await saveData();

    status.textContent =
      "AI study plan added to your Daily Planner successfully!";

    generatedAIActivities = [];
    document.getElementById("add-ai-plan").style.display = "none";
  });

// ===== AI TASK PRIORITIZATION =====

document.getElementById("prioritize-tasks")
  .addEventListener("click", async () => {
    const output =
      document.getElementById("task-priority-output");

    const button =
      document.getElementById("prioritize-tasks");

    const pendingTasks = data.tasks
      .filter(task => !task.completed);

    if (pendingTasks.length === 0) {
      output.textContent =
        "All your tasks are completed! 🎉 Add new tasks to get AI recommendations.";
      return;
    }

    button.disabled = true;
    button.textContent = "Analyzing your tasks...";

    output.textContent =
      "Anna AI is analyzing your pending tasks...";

    const taskList = pendingTasks
      .map((task, index) =>
        `${index + 1}. ${task.title}`
      )
      .join("\n");

    const prompt = `
You are a helpful student productivity assistant.

Analyze these pending student tasks:

${taskList}

Prioritize them based on:
1. Importance for learning.
2. Logical learning order.
3. Difficulty and preparation needed.

Return a numbered priority list.

For each task include:
- Priority: High, Medium, or Low.
- Why it should be done at this position.
- A reasonable estimated duration.

Do not invent deadlines.
Finish with one practical study tip.
`;

    try {
      const reply = await anna.llm.complete({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: prompt
            }
          }
        ],
        maxTokens: 900
      });

      let answer = "";

      if (typeof reply.content === "string") {
        answer = reply.content;
      } else if (
        reply.content &&
        typeof reply.content === "object" &&
        reply.content.type === "text"
      ) {
        answer = reply.content.text || "";
      } else if (Array.isArray(reply.content)) {
        answer = reply.content
          .filter(item => item.type === "text")
          .map(item => item.text)
          .join("\n");
      }

      output.textContent = answer ||
        "Sorry, I couldn't read the AI response.";

    } catch (error) {
      console.error("Task prioritization error:", error);

      output.textContent =
        "AI couldn't prioritize your tasks. Please try again.";
    } finally {
      button.disabled = false;
      button.textContent = "✨ Prioritize My Tasks";
    }
  });

// ===== AI DAILY PERFORMANCE INSIGHTS =====

document.getElementById("generate-ai-insights")
  .addEventListener("click", async () => {

    const output =
      document.getElementById("ai-insights-output");

    const button =
      document.getElementById("generate-ai-insights");

    button.disabled = true;
    button.textContent = "Analyzing your performance...";

    output.textContent =
      "Anna AI is reviewing your daily progress...";

    // Collect dashboard data.
    const completedTasks = data.tasks.filter(
      task => task.completed
    ).length;

    const totalTasks = data.tasks.length;

    const pendingTasks = totalTasks - completedTasks;

    const totalStudySeconds =
      (Number(data.dailyStudySeconds) || 0) +
      pausedSeconds +
      (startTime
        ? Math.floor((Date.now() - startTime) / 1000)
        : 0);

    const studyHours =
      (totalStudySeconds / 3600).toFixed(2);

    const completionRate = totalTasks
      ? Math.round((completedTasks / totalTasks) * 100)
      : 0;

    const prompt = `
You are an encouraging student performance coach.

Analyze this student dashboard data:

Study time today: ${studyHours} hours
Completed tasks: ${completedTasks}
Total tasks: ${totalTasks}
Pending tasks: ${pendingTasks}
Task completion rate: ${completionRate}%
Current study streak: ${data.currentStreak || 0}

Create a personalized daily performance report.

Include:
1. Study performance analysis.
2. Task completion analysis.
3. What went well.
4. One area to improve.
5. Three realistic suggestions for tomorrow.

Be supportive and practical.
Do not invent missing data or make unsupported claims.
Keep the report concise.
`;

    try {
      const reply = await anna.llm.complete({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: prompt
            }
          }
        ],
        maxTokens: 900
      });

      let answer = "";

      if (typeof reply.content === "string") {
        answer = reply.content;
      } else if (
        reply.content &&
        typeof reply.content === "object" &&
        reply.content.type === "text"
      ) {
        answer = reply.content.text || "";
      } else if (Array.isArray(reply.content)) {
        answer = reply.content
          .filter(item => item.type === "text")
          .map(item => item.text)
          .join("\n");
      }

      output.textContent = answer ||
        "Sorry, I couldn't read the AI response.";

    } catch (error) {
      console.error("AI Performance Insights error:", error);

      output.textContent =
        "Unable to generate insights. Please try again.";

    } finally {
      button.disabled = false;
      button.textContent = "✨ Analyze My Performance";
    }
  });

// ===== AI PERSONALIZED STUDY RECOMMENDATIONS =====

document.getElementById("generate-smart-suggestions")
  .addEventListener("click", async () => {

    const output =
      document.getElementById("smart-suggestion-output");

    const button =
      document.getElementById("generate-smart-suggestions");

    const pendingTasks = data.tasks.filter(
      task => !task.completed
    );

    const completedTasks = data.tasks.filter(
      task => task.completed
    ).length;

    const studySeconds =
      (Number(data.dailyStudySeconds) || 0) +
      pausedSeconds +
      (startTime
        ? Math.floor((Date.now() - startTime) / 1000)
        : 0);

    const studyHours = (studySeconds / 3600).toFixed(2);

    const prompt = `
You are an intelligent personal study advisor.

Analyze this student's current progress:

Pending tasks:
${pendingTasks.length
  ? pendingTasks.map(task => task.title).join("\n")
  : "No pending tasks"}

Completed tasks today: ${completedTasks}
Study time today: ${studyHours} hours
Current study streak: ${data.currentStreak || 0} days

Generate personalized study recommendations.

Include:
1. The best topic or task to study next.
2. Why it should be prioritized.
3. A practical learning activity.
4. A reasonable suggested study duration.
5. One tip to improve consistency.

Rules:
- Base recommendations on the provided tasks.
- Do not invent deadlines or subjects.
- Keep suggestions realistic and encouraging.
- If there are no pending tasks, recommend reviewing completed topics.
`;

    button.disabled = true;
    button.textContent = "Generating recommendations...";
    output.textContent = "Anna AI is analyzing your progress...";

    try {
      const reply = await anna.llm.complete({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: prompt
            }
          }
        ],
        maxTokens: 900
      });

      let answer = "";

      if (typeof reply.content === "string") {
        answer = reply.content;
      } else if (
        reply.content &&
        typeof reply.content === "object" &&
        reply.content.type === "text"
      ) {
        answer = reply.content.text || "";
      } else if (Array.isArray(reply.content)) {
        answer = reply.content
          .filter(item => item.type === "text")
          .map(item => item.text)
          .join("\n");
      }

      output.textContent = answer ||
        "Sorry, I couldn't read the AI response.";

    } catch (error) {
      console.error("AI recommendations error:", error);

      output.textContent =
        "Unable to generate recommendations. Please try again.";

    } finally {
      button.disabled = false;
      button.textContent = "✨ Generate AI Recommendations";
    }
  });







  // ===== POMODORO FOCUS TIMER =====


  let pomodoroSeconds = 120 * 60;
  let pomodoroInterval = null;
  let pomodoroMode = "focus";
  let pomodoroCompleted = Number(data.pomodoroCompleted) || 0;

  const pomodoroDisplay =
    document.getElementById("pomodoro-display");

  const pomodoroStatus =
    document.getElementById("pomodoro-status");

  const pomodoroSessions =
    document.getElementById("pomodoro-sessions");

  const pomodoroStart =
    document.getElementById("pomodoro-start");

  const pomodoroPause =
    document.getElementById("pomodoro-pause");

  const pomodoroReset =
    document.getElementById("pomodoro-reset");

  function updatePomodoroDisplay() {
    const minutes = Math.floor(pomodoroSeconds / 60);
    const seconds = pomodoroSeconds % 60;

    pomodoroDisplay.textContent =
      `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function stopPomodoro() {
    clearInterval(pomodoroInterval);
    pomodoroInterval = null;
  }

  function selectPomodoroMode(mode) {
    stopPomodoro();

    pomodoroMode = mode;

    pomodoroSeconds =
      mode === "focus" ? 120 * 60 :
      mode === "short" ? 5 * 60 :
      15 * 60;

    pomodoroStatus.textContent =
      mode === "focus"
        ? "Ready for a focus session?"
        : mode === "short"
          ? "Time for a short break."
          : "Time for a long break.";

    document.querySelectorAll(".pomodoro-modes button")
      .forEach(button => button.classList.remove("active"));

    document.getElementById(
      mode === "focus"
        ? "pomodoro-focus"
        : mode === "short"
          ? "pomodoro-short"
          : "pomodoro-long"
    ).classList.add("active");

    updatePomodoroDisplay();
  }

  document.getElementById("pomodoro-focus")
    .addEventListener("click", () => selectPomodoroMode("focus"));

  document.getElementById("pomodoro-short")
    .addEventListener("click", () => selectPomodoroMode("short"));

  document.getElementById("pomodoro-long")
    .addEventListener("click", () => selectPomodoroMode("long"));

  pomodoroStart.addEventListener("click", () => {
    if (pomodoroInterval) return;

    pomodoroStatus.textContent = "Stay focused. You've got this!";

    pomodoroInterval = setInterval(() => {
      if (pomodoroSeconds > 0) {
        pomodoroSeconds--;
        updatePomodoroDisplay();
      }

      if (pomodoroSeconds === 0) {
        stopPomodoro();


        if (pomodoroMode === "focus") {
          pomodoroCompleted++;
          data.pomodoroCompleted = pomodoroCompleted;

          // Add completed Pomodoro time to the main study tracker.
          const focusDurationSeconds = 120 * 60;

          data.totalStudySeconds =
            (data.totalStudySeconds || 0) + focusDurationSeconds;

          data.dailyStudySeconds =
            (data.dailyStudySeconds || 0) + focusDurationSeconds;

          data.sessions.push({
            date: getIndiaDate(),
            label: "Pomodoro Focus",
            durationSeconds: focusDurationSeconds
          });

          // Refresh dashboard and save progress.
          renderSessionHistory();
          renderAnalytics();
          renderOverview();

          timerDisplay.textContent =
            formatTime(data.totalStudySeconds);

          saveData().catch(error => {
            console.error("Pomodoro save error:", error);
          });

          pomodoroSessions.textContent =
            `Focus sessions completed: ${pomodoroCompleted}`;
        }
        // Automatically select the next Pomodoro mode.
        if (pomodoroMode === "focus") {
          const nextMode =
            pomodoroCompleted % 4 === 0 ? "long" : "short";

          selectPomodoroMode(nextMode);

          pomodoroStatus.textContent =
            nextMode === "long"
              ? "🎉 Four focus sessions completed! Your 15-minute break is ready."
              : "Great work! Your 5-minute break is ready. 🍅";

        } else {
          selectPomodoroMode("focus");

          pomodoroStatus.textContent =
            "Break completed! Your next 25-minute focus session is ready. 🚀";
        }



      }
    }, 1000);
  });

  pomodoroPause.addEventListener("click", () => {
    stopPomodoro();
    pomodoroStatus.textContent = "Timer paused.";
  });

  pomodoroReset.addEventListener("click", () => {
    stopPomodoro();

    pomodoroSeconds =
      pomodoroMode === "focus" ? 120 * 60 :
      pomodoroMode === "short" ? 5 * 60 :
      15 * 60;

    pomodoroStatus.textContent = "Timer reset.";
    updatePomodoroDisplay();
  });

  updatePomodoroDisplay();

  // Restore all saved information on startup.
  // Restore all saved information on startup.
  await checkDayRollover();
  setInterval(() => {
    checkDayRollover();
  }, 60 * 1000);

  renderGoal();
  renderTasks();
  renderOverview();
  renderSchedule();
  renderSessionHistory();

  timerDisplay.textContent = formatTime(data.totalStudySeconds);

}

main().catch(error => {
  console.error("CampusPilot startup error:", error);

  const status = document.getElementById("status");

  if (status) {
    status.textContent =
      "CampusPilot encountered a startup error. Check the browser console.";
  }
});
